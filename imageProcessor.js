// imageProcessor.js
const sharp = require('sharp');
const https = require('https');
const { Readable } = require('stream');

// Преобразование Buffer в ReadableStream (если понадобится)
const bufferToStream = (buffer) => Readable.from(buffer);

// Функция задержки (можно использовать во всех файлах)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Функция скачивания файла по URL (возвращает Promise<Buffer>)
function downloadFile(url) {
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
        resolve(Buffer.concat(data));
      });
    }).on('error', (err) => reject(err));
  });
}

// Функция масштабирования изображения под сетку 8xN (N ≤ 12)
async function resizeTo8Cols(buffer) {
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
