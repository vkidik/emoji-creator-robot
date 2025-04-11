// imageProcessor.js
const sharp = require('sharp');
const https = require('https');
const fs = require('fs');
const { Readable } = require('stream');

// Преобразование Buffer в ReadableStream (если понадобится)
const bufferToStream = (buffer) => Readable.from(buffer);

// Функция задержки (можно использовать во всех файлах)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Функция скачивания файла по URL (возвращает Promise<Buffer>)
function downloadFile(url,saveOnPath = null) {
  return new Promise((resolve, reject) => {
    console.log('Начало загрузки файла...');
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Ошибка при загрузке файла. Код: ${res.statusCode}`));
      }
      const data = [];
      res.on('data', (chunk) => data.push(chunk));
      res.on('end', () => {
        console.log('Файл успешно загружен.');
        let buffer = Buffer.concat(data);
        // Надо ли сохранить файл в папке
        if(saveOnPath != null){
          fs.writeFileSync(saveOnPath + 'trigger.mp4',buffer)
        }
        resolve(buffer);
      });
    }).on('error', (err) => reject(err));
  });
}
function hexToRgb(hex) {
  const match = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!match) return null;
  return {
      r: parseInt(match[1], 16),
      g: parseInt(match[2], 16),
      b: parseInt(match[3], 16)
  };
}

function isSameColor(r1, g1, b1, r2, g2, b2, tolerance = 200) {
  return (
      Math.abs(r1 - r2) <= tolerance &&
      Math.abs(g1 - g2) <= tolerance &&
      Math.abs(b1 - b2) <= tolerance
  );
}
async function removeBackgroundFromImage(imagePath, colorHex) {
  if(!colorHex) return;
  const color = this.hexToRgb(colorHex);
  if (!color) return;

  const image = sharp(imagePath);
  const { data, info } = await image.raw().ensureAlpha().toBuffer({ resolveWithObject: true });

  for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      if (this.isSameColor(r, g, b, color.r, color.g, color.b)) {
          // Делаем пиксель полностью прозрачным
          data[i + 3] = 0;
      }
  }
}
// Функция масштабирования изображения под сетку 8xN (N ≤ 12)
async function resizeTo8Cols(buffer,chromo = null) {
  console.log('Начало масштабирования изображения...');
  let image = sharp(buffer).ensureAlpha();
  const metadata = await image.metadata();
  const origWidth = metadata.width;
  const origHeight = metadata.height;

  let scale = (origWidth > 800) ? (800 / origWidth) : 1;
  let newWidth = Math.round(origWidth * scale);
  let newHeight = Math.round(origHeight * scale);

  if (newHeight > 1200) {
    scale = scale * (1200 / newHeight);
    newWidth = Math.round(origWidth * scale);
    newHeight = Math.round(origHeight * scale);
  }
  image = image.resize(newWidth, newHeight);

  const targetWidth = 800;
  const targetHeight = Math.min(Math.ceil(newHeight / 100) * 100, 1200);

  const padLeft = Math.floor((targetWidth - newWidth) / 2);
  const padRight = targetWidth - newWidth - padLeft;
  const padTop = Math.floor((targetHeight - newHeight) / 2);
  const padBottom = targetHeight - newHeight - padTop;

  const finalBuffer = await image
    .extend({
      top: padTop,
      bottom: padBottom,
      left: padLeft,
      right: padRight,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();

  
  console.log(`Масштабирование завершено. Итоговый размер: ${targetWidth}x${targetHeight}`);
  return finalBuffer;
}

// Функция нарезки изображения на квадраты 100×100 пикселей
async function splitImageToSquares(buffer) {
  console.log('Начало нарезки изображения на квадраты 100x100...');
  const image = sharp(buffer);
  const metadata = await image.metadata();
  const cols = 8; // всегда 8 колонок
  const rows = metadata.height / 100;
  const squares = [];

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const left = x * 100;
      const top = y * 100;
      const squareBuffer = await sharp(buffer)
        .extract({ left, top, width: 100, height: 100 })
        .png()
        .toBuffer();
      squares.push(squareBuffer);
    }
  }
  console.log(`Нарезка завершена: получено ${squares.length} квадратиков (${cols} колонок, ${rows} строк).`);
  return { squares, cols, rows };
}

// Функция конвертации изображения в PNG (для стикеров)
async function convertToPng(buffer) {
  return sharp(buffer).png().toBuffer();
}

module.exports = {
  downloadFile,
  resizeTo8Cols,
  splitImageToSquares,
  convertToPng,
  sleep,
  bufferToStream
};
