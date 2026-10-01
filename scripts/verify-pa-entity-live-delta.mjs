#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import crypto from 'node:crypto'

const root='docs/pa-entity-floot-release'
const specs=[
  {
    patch:'FLOOT_LIVE_DELTA_1_OPENAPI.txt',
    target:'static/openapi.json',
    fixture:'openapi.json',
    maxBytes:32000,
  },
  {
    patch:'FLOOT_LIVE_DELTA_2_CANONICAL_X402.txt',
    target:'static/.well-known/x402',
    fixture:'x402',
    maxBytes:16000,
  },
]

function parseSingle(path){
  const text=fs.readFileSync(path,'utf8').replace(/\r\n/g,'\n')
  const lines=text.split('\n')
  const start=lines.findIndex(line=>line.startsWith('*** Add File: '))
  assert.ok(start>=0, path+' missing Add File')
  const target=lines[start].slice('*** Add File: '.length)
  const end=lines.indexOf('*** End Patch',start+1)
  assert.ok(end>start, path+' missing End Patch')
  const body=lines.slice(start+1,end)
  for(const line of body) assert.ok(line.startsWith('+'), path+' contains non-add line')
  return {target,content:body.map(line=>line.slice(1)).join('\n')+'\n'}
}

const fingerprint=[]
for(const spec of specs){
  const patchPath=`${root}/${spec.patch}`
  const bytes=fs.statSync(patchPath).size
  assert.ok(bytes<spec.maxBytes,`${spec.patch} too large: ${bytes}`)
  const parsed=parseSingle(patchPath)
  assert.equal(parsed.target,spec.target,`${spec.patch} wrong target`)
  const fixture=fs.readFileSync(`${root}/${spec.fixture}`,'utf8').replace(/\r\n/g,'\n')
  assert.equal(parsed.content,fixture,`${spec.patch} drift from ${spec.fixture}`)
  fingerprint.push(`${spec.target}\0${crypto.createHash('sha256').update(Buffer.from(fixture)).digest('hex')}`)
  console.log(`DELTA_OK ${spec.patch} bytes=${bytes} target=${spec.target}`)
}
const hash=crypto.createHash('sha256').update(fingerprint.join('\n')).digest('hex')
console.log('PA Entity live delta parity: 2/2 exact')
console.log('LIVE_DELTA_FINGERPRINT='+hash)
