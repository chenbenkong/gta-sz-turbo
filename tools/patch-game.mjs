// One-shot patcher for game.js integration fixes.
import fs from 'node:fs';

let s = fs.readFileSync('src/game.js', 'utf8');

const init = `  let treeSpots = [];
  let crowd = null;
  try {
    setLoad(ui, 0.9, '种植行道树…');
    treeSpots = await loadJSON('city/trees.json');
  } catch (_) { treeSpots = []; }
  try {
    setLoad(ui, 0.93, '召集行人…');
    const paths = await loadJSON('city/pedestrian-paths.json');
    const flat = Array.isArray(paths[0]) ? paths.flat() : paths;
    crowd = createCrowd(flat, 32);
  } catch (e) { console.warn('crowd', e); }
`;

const start = s.indexOf('  let treeSpots = [];');
const endMarker = '  let crowd = null;';
const end = s.indexOf(endMarker, start);
if (start >= 0 && end >= 0) {
  s = s.slice(0, start) + init + s.slice(end + endMarker.length + 1);
  console.log('init block replaced');
} else {
  console.log('init block NOT found', start, end);
}

s = s.replace(
  /    \/\/ landmarks \(already in city coordinates\)[\s\S]*?drawMesh\(gl, glbLandmarks\);\n    \}\n    gl\.enable\(gl\.CULL_FACE\);\n/,
  ''
);
console.log('landmarks block cleaned', !s.includes('glbLandmarks'));

const bStart = s.indexOf('    // buildings + landmarks');
const bEnd = s.indexOf('    // water (blend)');
console.log('building draw', bStart, bEnd);
if (bStart >= 0 && bEnd > bStart) {
  const repl = `    // streamed original buildings + roads (or procedural fallback)
    if (streamReady) {
      gl.useProgram(cityProg);
      gl.disable(gl.CULL_FACE);
      setCommon(cityU, {
        uModel: world.identity,
        uUseTex: 0,
        uWindowGrid: 1,
        uEmissive: 1,
      });
      await streamer.update(player.x, player.z, [
        { name: 'roads', maxDist: 320, budget: 32, lodDist: 180 },
        { name: 'buildings', maxDist: 500, budget: 36, lodDist: 200 },
        { name: 'landmarks', maxDist: 2500, budget: 4, lodDist: 99999 },
      ], cityProg, cityU, world.identity);
      gl.enable(gl.CULL_FACE);
    } else {
      gl.useProgram(cityProg);
      gl.disable(gl.CULL_FACE);
      setCommon(cityU, {
        uModel: world.identity,
        uUseTex: 0,
        uWindowGrid: 1,
        uEmissive: 1,
      });
      drawMesh(gl, world.buildings);
      drawMesh(gl, world.landmarks);
      gl.enable(gl.CULL_FACE);
    }

`;
  s = s.slice(0, bStart) + repl + s.slice(bEnd);
  console.log('stream draw installed');
}

s = s.split('drawMesh(gl, glbPed);').join('drawMesh(gl, glbChar || glbPed);');
s = s.split('uPaint: [0.75, 0.35, 0.25],').join('uPaint: [1, 1, 1],');

// make frame() able to await streamer
if (!s.includes('async function frame')) {
  s = s.replace('function frame(now) {', 'async function frame(now) {');
  console.log('frame is async');
}

fs.writeFileSync('src/game.js', s);
console.log('done, length', s.length);
