import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

describe('Milestone 4: Client Screens & Production Bundle', () => {
  it('dist/client/index.html exists and references bundled assets', () => {
    const indexPath = path.resolve(process.cwd(), 'dist/client/index.html');
    assert.equal(fs.existsSync(indexPath), true, 'dist/client/index.html must exist');
    const html = fs.readFileSync(indexPath, 'utf-8');
    assert.match(html, /<div id="root"><\/div>/, 'index.html must contain root div');
    assert.match(html, /src="\/assets\/index-[^"]+\.js"/, 'index.html must reference bundled JS');
    assert.match(html, /href="\/assets\/index-[^"]+\.css"/, 'index.html must reference bundled CSS');
  });

  it('dist/client/assets contains JS and CSS artifacts', () => {
    const assetsDir = path.resolve(process.cwd(), 'dist/client/assets');
    assert.equal(fs.existsSync(assetsDir), true, 'dist/client/assets must exist');
    const files = fs.readdirSync(assetsDir);
    const hasJs = files.some((f) => f.startsWith('index-') && f.endsWith('.js'));
    const hasCss = files.some((f) => f.startsWith('index-') && f.endsWith('.css'));
    assert.equal(hasJs, true, 'bundled JS must exist in assets');
    assert.equal(hasCss, true, 'bundled CSS must exist in assets');
  });

  it('all client screens and components exist in client/src', () => {
    const requiredFiles = [
      'client/src/main.tsx',
      'client/src/App.tsx',
      'client/src/screens/JoinScreen.tsx',
      'client/src/screens/LobbyScreen.tsx',
      'client/src/screens/RoleSelectScreen.tsx',
      'client/src/screens/BroadcastScreen.tsx',
      'client/src/screens/ReplayScreen.tsx',
      'client/src/components/TvDisplay.tsx',
      'client/src/components/TickerBar.tsx',
      'client/src/components/FloatingReactions.tsx',
    ];

    for (const relPath of requiredFiles) {
      const fullPath = path.resolve(process.cwd(), relPath);
      assert.equal(fs.existsSync(fullPath), true, `${relPath} must exist`);
    }
  });
});
