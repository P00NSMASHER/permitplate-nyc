"use strict";

const PA_SOURCE = "https://data.pa.gov/resource/xvd7-5r2c.json";
const CENSUS_DEMO = "https://api-v2.appdeploy.ai/app/us-census-address-geocoder-x402-23mj4x/api/demo";
const RDAP_DEMO = "https://api-v2.appdeploy.ai/app/domain-rdap-lookup-x402-spdfnq/api/demo";

function canonicalBusinessName(value) {
  let text = String(value || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  const suffix = /\s+(?:L\s+L\s+C|LLC|INCORPORATED|INC|CORPORATION|CORP|COMPANY|CO|LIMITED|LTD|L\s+P|LP|L\s+L\s+P|LLP|P\s+C|PC)$/;
  let previous = "";
  while (text !== previous) {
    previous = text;
    text = text.replace(suffix, "").trim();
  }
  return text;
}

function matchScore(name, query) {
  const candidate = canonicalBusinessName(name);
  const wanted = canonicalBusinessName(query);
  if (candidate === wanted) return 0;
  if (candidate.startsWith(wanted + " ")) return 1;
  if ((" " + candidate + " ").includes(" " + wanted + " ")) return 2;
  if (candidate.replaceAll(" ","").includes(wanted.replaceAll(" ",""))) return 3;
  return 4;
}

function mapEntity(row) {
  return {
    businessName: row.business_name ?? null,
    filingNumber: row.filing_number ?? null,
    registrationType: row.typeofbusinessregistration ?? null,
    creationDate: row.creationdate ? String(row.creationdate).slice(0,10) : null,
    address1: row.address_line1 ?? null,
    address2: row.address_line2 ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    zip: row.zip ?? null
  };
}

async function fetchJson(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error("upstream_http_" + res.status);
  return await res.json();
}

function rankRows(rows, company) {
  return rows.map(mapEntity).sort((a,b) => {
    const d = matchScore(a.businessName || "", company) - matchScore(b.businessName || "", company);
    if (d) return d;
    return String(a.businessName || "").localeCompare(String(b.businessName || ""));
  });
}

function registryUrl(company, contains = false) {
  const escaped = company.toUpperCase().replaceAll("'","''");
  const pattern = contains ? `%${escaped}%` : `${escaped}%`;
  const url = new URL(PA_SOURCE);
  url.searchParams.set("$select","distinct business_name,filing_number,address_line1,address_line2,city,state,zip,typeofbusinessregistration,creationdate");
  url.searchParams.set("$where",`upper(business_name) like '${pattern}'`);
  url.searchParams.set("$limit","50");
  return url.toString();
}

function coordinates(row) {
  const lon = row?.coordinates?.longitude;
  const lat = row?.coordinates?.latitude;
  return typeof lon === "number" && typeof lat === "number" ? { longitude: lon, latitude: lat } : null;
}

function distanceMiles(a,b) {
  const radians = (d) => d * Math.PI / 180;
  const R = 3958.7613;
  const dLat = radians(b.latitude-a.latitude);
  const dLon = radians(b.longitude-a.longitude);
  const h = Math.sin(dLat/2)**2 + Math.cos(radians(a.latitude))*Math.cos(radians(b.latitude))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
}

function addressIdentity(value) {
  const text = String(value || "").toUpperCase();
  const street = text.match(/^\s*(\d+[A-Z-]*)\b/)?.[1] ?? null;
  const zip = text.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] ?? null;
  return { streetNumber: street, zip };
}

function createAppDeployPublicAdapters({ fetchImpl = fetch } = {}) {
  return {
    registry: {
      async lookup({ company }) {
        let rows = await fetchJson(registryUrl(company,false), fetchImpl);
        if (!Array.isArray(rows)) rows = [];
        if (!rows.length) {
          rows = await fetchJson(registryUrl(company,true), fetchImpl);
          if (!Array.isArray(rows)) rows = [];
        }
        const ranked = rankRows(rows, company);
        const strong = ranked.filter((r) => matchScore(r.businessName || "", company) <= 1);
        return {
          available: true,
          strongMatch: ranked.length > 0 && matchScore(ranked[0].businessName || "", company) <= 1 && strong.length === 1,
          entity: ranked[0] ?? null,
          candidateCount: ranked.length,
          strongCandidateCount: strong.length,
          provenance: { source: "Pennsylvania Department of State via data.pa.gov" }
        };
      }
    },
    address: {
      async compare({ suppliedAddress, registryAddress }) {
        const [submitted, registered] = await Promise.all([
          fetchJson(CENSUS_DEMO + "?address=" + encodeURIComponent(suppliedAddress), fetchImpl),
          fetchJson(CENSUS_DEMO + "?address=" + encodeURIComponent(registryAddress), fetchImpl)
        ]);
        const a = coordinates(submitted);
        const b = coordinates(registered);
        const ia = addressIdentity(submitted?.matchedAddress);
        const ib = addressIdentity(registered?.matchedAddress);
        return {
          available:
            typeof submitted?.matched === "boolean" &&
            typeof registered?.matched === "boolean" &&
            /Census Bureau/i.test(String(submitted?.source || "")) &&
            /Census Bureau/i.test(String(registered?.source || "")),
          suppliedMatched: submitted?.matched === true,
          registryMatched: registered?.matched === true,
          sameStreetNumber: ia.streetNumber != null && ia.streetNumber === ib.streetNumber,
          sameZip: ia.zip != null && ia.zip === ib.zip,
          distanceMiles: a && b ? Number(distanceMiles(a,b).toFixed(3)) : null,
          provenance: { source: "U.S. Census Bureau Geocoding Services" }
        };
      }
    },
    rdap: {
      async lookup({ domain }) {
        const row = await fetchJson(RDAP_DEMO + "?domain=" + encodeURIComponent(domain), fetchImpl);
        const returned = typeof row?.domain === "string" ? row.domain.toLowerCase().replace(/\.$/,"") : null;
        return {
          available:
            returned === domain.toLowerCase() &&
            typeof row?.registered === "boolean" &&
            typeof row?.source === "string" &&
            row.source.length > 0,
          registered: row?.registered === true,
          authoritativeRdap: row?.authoritativeRdap ?? null,
          provenance: { source: row?.source ?? "RDAP" }
        };
      }
    }
  };
}

module.exports = { createAppDeployPublicAdapters, matchScore, canonicalBusinessName, addressIdentity, distanceMiles };
