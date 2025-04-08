// index.js
const { Telegraf } = require('telegraf');
const sharp = require('sharp');
const https = require('https');
const { Readable } = require('stream');

// Преобразование Buffer в ReadableStream
const bufferToStream = (buffer) => {
  return Readable.from(buffer);
};

const bot = new Telegraf('BOT_API_TOKEN');

let botUsername = null;
bot.telegram.getMe()
  .then((me) => {
    botUsername = me.username.toLowerCase();
    console.log(`Bot username: ${botUsername}`);
  })
  .catch(console.error);

/**
 * Функция для ожидания указанного количества миллисекунд.
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Функция для загрузки файла по URL и получения Buffer
 */
const downloadFile = (url) => {
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
};

/**
 * Функция для нарезки изображения на квадраты 100x100.
 * Если размеры не кратны 100 – добавляется прозрачный фон.
 * Возвращает объект: { squares, cols, rows, newWidth, newHeight }
 */
const splitImageToSquares = async (buffer) => {
  console.log('Начало нарезки изображения...');
  // Обеспечиваем наличие альфа-канала
  const image = sharp(buffer).ensureAlpha();
  const metadata = await image.metadata();
  const originalWidth = metadata.width;
  const originalHeight = metadata.height;

  const newWidth = Math.ceil(originalWidth / 100) * 100;
  const newHeight = Math.ceil(originalHeight / 100) * 100;

  let paddedImage = image;
  if (newWidth !== originalWidth || newHeight !== originalHeight) {
    paddedImage = image.extend({
      right: newWidth - originalWidth,
      bottom: newHeight - originalHeight,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }).ensureAlpha();
    console.log(`Добавлен прозрачный фон: ${newWidth - originalWidth}px справа, ${newHeight - originalHeight}px снизу.`);
  }

  // Конвертируем в PNG для сохранения прозрачности
  const paddedBuffer = await paddedImage.png().toBuffer();
  const cols = newWidth / 100;
  const rows = newHeight / 100;
  const squares = [];

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const left = x * 100;
      const top = y * 100;
      const squareBuffer = await sharp(paddedBuffer)
        .extract({ left, top, width: 100, height: 100 })
        .toBuffer();
      squares.push(squareBuffer);
    }
  }
  console.log(`Нарезка завершена: получено ${squares.length} квадратиков (${cols} колонок, ${rows} строк).`);
  return { squares, cols, rows, newWidth, newHeight };
};

/**
 * Конвертация изображения в формат PNG (для создания кастомных эмодзи)
 */
const convertToPng = async (buffer) => {
  return sharp(buffer)
    .png()
    .toBuffer();
};

// При старте информируем пользователя о требовании по количеству стикеров и допустимых размерах
bot.start((ctx) =>
  ctx.reply(
    'Привет! Отправь фотографию с подписью (название пакета).\n\n' +
    'Важно: Эмодзи пак может содержать меньше или ровно 200 стикеров (каждый 100x100 пикселей). ' +
    'Если будет получено больше или меньше квадратов – создание пака не будет выполнено.'
  )
);

bot.on('photo', async (ctx) => {
  try {
    console.log('Получено фото от пользователя.');
    if (!botUsername) {
      await ctx.reply('Бот ещё не готов, попробуйте чуть позже.');
      return;
    }
    // Получаем название пака из подписи или задаем значение по умолчанию
    const packTitle = ctx.message.caption || 'Без названия';
    const userUsername = ctx.from.username ? ctx.from.username : ctx.from.first_name;
    // Новый формат отображаемого названия
    const displayTitle = `@${userUsername} ${packTitle} | Создано: @${botUsername}`;

    // await ctx.reply(`Создаем эмодзи пак: ${displayTitle}`);
    console.log(`Название пака: ${displayTitle}`);

    // Берём фото с наивысшим разрешением
    const photoSizes = ctx.message.photo;
    const highestResPhoto = photoSizes[photoSizes.length - 1];
    const fileId = highestResPhoto.file_id;

    // Скачиваем изображение
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const imageBuffer = await downloadFile(fileLink.href);

    // Нарезаем изображение на квадраты 100x100
    const { squares, cols, rows } = await splitImageToSquares(imageBuffer);

    // Проверяем, получилось ли <= 200 квадратов
    if (squares.length > 200) {
      await ctx.reply(
        `Ошибка: получено ${squares.length} квадратов. ` +
        'Пожалуйста, отправьте изображение, которое после нарезки на квадраты 100×100 даст меньше 200 элементов. ' +
        'Например, изображение 2000×1000 пикселей (20 колонок x 10 строк).'
      );
      return;
    }

    console.log('Начало параллельной конвертации квадратиков в PNG...');
    // Параллельная конвертация
    const stickersPng = await Promise.all(squares.map(square => convertToPng(square)));
    console.log('Конвертация завершена.');

    const userId = ctx.from.id;
    const uniquePart = Date.now();
    // Имя набора: должно состоять только из маленьких букв, цифр и подчёркиваний и заканчиваться на _by_<botUsername>
    let setName = `emoji_${userId}_${uniquePart}_by_${botUsername}`;
    if (setName.length > 64) {
      setName = setName.substring(0, 63);
    }
    console.log(`Сгенерировано имя набора: ${setName}`);

    console.log('Создание нового стикер пака...');
    // Создаём набор с первым стикером
    const firstStickerBuffer = stickersPng.shift();
    await ctx.telegram.createNewStickerSet(
      userId,
      setName,
      displayTitle,
      {
        png_sticker: { source: bufferToStream(firstStickerBuffer), filename: 'sticker.png' },
        sticker_format: 'static',
        sticker_type: 'custom_emoji',
        emojis: "🧩"
      }
    );
    console.log('Стикер пак создан.');

    // Функция-обёртка для добавления стикера с повторными попытками при ошибке 429
    async function addStickerToSetWithRetry(userId, setName, payload, attempt = 0) {
      try {
        return await ctx.telegram.addStickerToSet(userId, setName, payload);
      } catch (error) {
        if (error.response && error.response.error_code === 429 && attempt < 5) {
          let waitTime = error.response.parameters.retry_after || 3;
          console.log(`Rate limit hit. Retrying after ${waitTime} seconds...`);
          await sleep(waitTime * 1000);
          return await addStickerToSetWithRetry(userId, setName, payload, attempt + 1);
        } else {
          throw error;
        }
      }
    }

    // Добавляем оставшиеся стикеры пакетами по 10 штук
    console.log('Начало добавления оставшихся стикеров пакетами...');
    const batchSize = 10;
    for (let i = 0; i < stickersPng.length; i += batchSize) {
      const batch = stickersPng.slice(i, i + batchSize);
      await Promise.all(batch.map(async (pngBuffer) => {
        const payload = {
          png_sticker: { source: bufferToStream(pngBuffer), filename: 'sticker.png' },
          sticker_format: 'static',
          sticker_type: 'custom_emoji',
          emojis: "🧩"
        };
        return addStickerToSetWithRetry(userId, setName, payload);
      }));
      console.log(`Добавлена партия стикеров ${i + 1} - ${Math.min(i + batchSize, stickersPng.length)}`);
    }
    console.log('Все стикеры добавлены.');

    // Формируем ссылку на созданный стикер пак
    const stickerPackLink = `https://t.me/addstickers/${setName}`;
    console.log(`Стикер пак создан: ${stickerPackLink}`);

    // Отправляем сообщение со ссылкой на набор
    await ctx.reply(`Эмодзи пак "${displayTitle}" успешно создан!\nСсылка: ${stickerPackLink}`);

    // Получаем информацию о наборе, чтобы отправить стикеры в виде грида
    console.log('Получение информации о наборе стикеров...');
    const stickerSet = await ctx.telegram.getStickerSet(setName);
    const stickers = stickerSet.stickers;
    
    if (!stickers || stickers.length === 0) {
      await ctx.reply('Не удалось получить информацию о созданном наборе.');
      return;
    }
    console.log(`Получено стикеров: ${stickers.length}. Отправляем стикеры группами.`);

    // Отправка стикеров рядами (по cols с задержкой между рядами)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const index = r * cols + c;
        if (index < stickers.length) {
          await ctx.telegram.sendSticker(ctx.chat.id, stickers[index].file_id);
        }
      }
      // Задержка 500 мс между рядами
      await sleep(500);
    }
    console.log('Стикеры отправлены.');

  } catch (err) {
    console.error('Ошибка в процессе создания эмодзи пака:', err);
    // При ошибке также напоминаем о допустимых размерах изображения
    await ctx.reply(
      `Произошла ошибка при создании эмодзи пака: ${err.message}\n`
    );
  }
});

bot.launch().then(() => {
  console.log('Бот запущен...');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
