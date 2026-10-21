import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
const root = new URL('../apps/parent-wechat/miniprogram/assets/icons/', import.meta.url);
await mkdir(root, { recursive: true });
const paths = {
  message: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2v-9.5A8.5 8.5 0 0 1 10.5 4H13a8 8 0 0 1 8 7.5Z"/><path d="M7 10h9M7 14h6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m9 3-1 3-3 1-2 4 2 3 1 3 4 3 3-1 3-1 3-4-1-3-1-3-4-3Z"/>',
  headphones: '<path d="M4 14v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="12" width="4" height="8" rx="2"/><rect x="17" y="12" width="4" height="8" rx="2"/>',
  gift: '<path d="M4 11v10h16V11M12 7v14"/><rect x="2" y="7" width="20" height="4" rx="1"/><path d="M12 7C3 7 5 0 9 3l3 4Zm0 0c9 0 7-7 3-4l-3 4Z"/>',
};
for (const [name, path] of Object.entries(paths)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#8064d9" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(new URL(`${name}.png`, root).pathname.replace(/^\/(\w:)/, '$1'));
}
console.log('Generated four bundled App icons.');
