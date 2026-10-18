// 把网页文件复制到 www/，供 Capacitor 打包进安卓 app（sw.js 不需要，app 自带全部文件）
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(root, 'www');
const files = [
  'index.html', 'ddz.html', 'poker.html', 'mahjong.html', 'sichuan.html', 'bridge.html',
  'tiaoqi.html', 'tiaoqi-engine.js', 'junqi.html', 'junqi-engine.js', 'guandan.html', 'guandan-engine.js',
  'style.css', 'poker.css', 'bridge.css', 'bridge-engine.js', 'bridge-bid.js', 'bridge-play.js', 'bridge.js', 'engine.js', 'game.js', 'poker-engine.js', 'poker.js', 'sfx.js',
  'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png',
];
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of files) {
  const src = path.join(root, f);
  if (!fs.existsSync(src)) throw new Error('缺少文件 ' + f);
  fs.copyFileSync(src, path.join(out, f));
}
console.log('www 已生成：' + files.length + ' 个文件');
