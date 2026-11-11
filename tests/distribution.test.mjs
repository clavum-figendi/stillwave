import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
const root = new URL('../web/',import.meta.url);
test('the service worker precaches every distributed app file with relative URLs', async()=>{
  const source=await readFile(new URL('sw.js',root),'utf8');
  const list=source.match(/const ASSETS=\[([^\]]+)\]/)[1];
  const assets=[...list.matchAll(/'([^']+)'/g)].map(x=>x[1]);
  const entries=await readdir(root,{recursive:true,withFileTypes:true});
  for(const entry of entries.filter(e=>e.isFile())){
    const path=entry.parentPath.replace(new URL(root).pathname,'')+(entry.parentPath.endsWith('/')?'':'/')+entry.name;
    const relative='./'+path.replace(/^\//,'');
    assert.ok(assets.includes(relative),`${relative} missing from offline precache`);
  }
  assert.ok(assets.every(asset=>asset.startsWith('./')));
});
test('manifest is subpath safe and PNG icons have their declared dimensions',async()=>{
  const manifest=JSON.parse(await readFile(new URL('manifest.webmanifest',root),'utf8'));
  assert.equal(manifest.scope,'./'); assert.equal(manifest.start_url,'./');
  for(const size of [192,512]){
    const icon=manifest.icons.find(icon=>icon.sizes===`${size}x${size}`);
    assert.ok(icon);assert.ok(icon.src.startsWith('./'));
    const bytes=await readFile(new URL(icon.src,root));
    assert.equal(bytes.readUInt32BE(16),size);assert.equal(bytes.readUInt32BE(20),size);
  }
});
