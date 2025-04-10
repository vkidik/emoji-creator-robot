// queueManager.js
const { downloadFile, resizeTo8Cols, splitImageToSquares, convertToPng } = require('./imageProcessor');
const { sleep } = require('./utils');  // можно определить функцию sleep в utils.js или прямо здесь

// Очередь заданий
class JobQueue {
  constructor() {
    this.queue = [];
    this.running = false;
    // Запускаем интервал обновления для ожидающих заданий (каждые 2 секунды)
    setInterval(() => this.updateWaitingJobs(), 2000);
  }

  // Метод для добавления задания в очередь
  async addJob(job) {
    // Отправляем пользователю сообщение с информацией о позиции в очереди
    const position = this.queue.length + 1; // будет обновлено автоматически
    try {
      job.progressMessage = await job.ctx.reply(`Ваше фото поставлено в очередь. Место: ${position}`);
    } catch (err) {
      console.error('Ошибка отправки сообщения о позиции:', err.message);
    }
    // Добавляем задание в очередь
    this.queue.push(job);
    // Запускаем процесс, если не запущен
    if (!this.running) {
      this.run();
    }
  }

  // Обновляет сообщения для ожидающих заданий
  async updateWaitingJobs() {
    // Для каждого задания в очереди (кроме текущего обрабатываемого) обновляем позицию
    for (let i = 0; i < this.queue.length; i++) {
      const job = this.queue[i];
      if (job.progressMessage) {
        const newText = `Ваше фото в очереди. Место: ${i + 1} из ${this.queue.length}`;
        try {
          await job.ctx.telegram.editMessageText(
            job.ctx.chat.id,
            job.progressMessage.message_id,
            undefined,
            newText
          );
        } catch (err) {
          // Игнорируем ошибку, если сообщение уже обновлено/удалено
        }
      }
    }
  }

  // Последовательная обработка заданий
  async run() {
    this.running = true;
    while (this.queue.length) {
      // Извлекаем задание (FIFO)
      const job = this.queue.shift();
      // Перед началом обработки обновляем сообщение для текущего задания
      let progressInterval = null;
      const startTime = Date.now();
      try {
        // Устанавливаем интервал обновления сообщения для активной обработки:
        job.progressMessage = await job.ctx.telegram.editMessageText(
          job.ctx.chat.id,
          job.progressMessage.message_id,
          undefined,
          `Начинается обработка фото...`
        );

        progressInterval = setInterval(async () => {
          const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
          const text = `Обработка фото... (${elapsedSeconds} сек прошло)`;
          try {
            await job.ctx.telegram.editMessageText(
              job.ctx.chat.id,
              job.progressMessage.message_id,
              undefined,
              text
            );
          } catch (e) {
            // Если не удалось обновить сообщение, пропускаем
          }
        }, 1500);

        // Обрабатываем фото (основная логика вынесена в processPhotoJob)
        await processPhotoJob(job);
      } catch (err) {
        console.error('Ошибка при обработке задания:', err);
        try {
          await job.ctx.telegram.editMessageText(
            job.ctx.chat.id,
            job.progressMessage.message_id,
            undefined,
            '❌ Произошла ошибка при обработке фото.'
          );
        } catch (e) { }
      } finally {
        if (progressInterval) clearInterval(progressInterval);
      }
    }
    this.running = false;
  }
}

const jobQueue = new JobQueue();

// Функция для обработки одного задания
async function processPhotoJob(job) {
  const ctx = job.ctx;
  console.log(`Начинается обработка фото для пользователя ${job.userId}`);
  // Определяем название пака, формируем displayTitle
  const packTitle = job.caption;
  const userUsername = ctx.from.username || ctx.from.first_name;
  const displayTitle = `@${userUsername} ${packTitle} | Создано: @${job.botUsername}`;

  // Получаем ссылку на файл
  const fileLink = await ctx.telegram.getFileLink(job.fileId);
  // Скачиваем фото
  const imageBuffer = await downloadFile(fileLink.href);
  // Масштабируем изображение
  const resizedBuffer = await resizeTo8Cols(imageBuffer);
  // Нарезаем изображение на квадраты 100x100
  const { squares, cols, rows } = await splitImageToSquares(resizedBuffer);

  // Проверка на количество стикеров
  if (squares.length > 200) {
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      job.progressMessage.message_id,
      undefined,
      `Ошибка: получено ${squares.length} квадратов. Отправьте изображение с не более 200 стикерами.`
    );
    return;
  }

  // Конвертируем квадраты в PNG
  console.log('Параллельная конвертация в PNG...');
  const stickersPng = await Promise.all(squares.map(square => convertToPng(square)));
  console.log('Конвертация завершена.');

  // Создаём имя стикерпака
  const userId = ctx.from.id;
  const uniquePart = Date.now();
  let setName = `emoji_${userId}_${uniquePart}_by_${job.botUsername}`;
  if (setName.length > 64) {
    setName = setName.substring(0, 63);
  }
  console.log(`Имя набора: ${setName}`);

  // Создаём стикер пак (первый стикер)
  const firstStickerBuffer = stickersPng.shift();
  await ctx.telegram.createNewStickerSet(
    userId,
    setName,
    displayTitle,
    {
      png_sticker: { source: firstStickerBuffer, filename: 'sticker.png' },
      sticker_format: 'static',
      sticker_type: 'custom_emoji',
      emojis: "🧩"
    }
  );
  console.log('Стикер пак создан.');

  // Функция добавления стикера с повторными попытками (до 5 попыток при 429)
  async function addStickerToSetWithRetry(stickerBuffer, attempt = 0) {
    const payload = {
      png_sticker: { source: stickerBuffer, filename: 'sticker.png' },
      sticker_format: 'static',
      sticker_type: 'custom_emoji',
      emojis: "🧩"
    };
    try {
      return await ctx.telegram.addStickerToSet(userId, setName, payload);
    } catch (error) {
      console.error(`Ошибка при добавлении стикера, попытка ${attempt + 1}:`, error.message);
      if (error.response && error.response.error_code === 429 && attempt < 5) {
        const waitTime = error.response.parameters.retry_after || 1;
        console.log(`Rate limit. Повтор через ${waitTime} секунд...`);
        await sleep(waitTime * 1000);
        return await addStickerToSetWithRetry(stickerBuffer, attempt + 1);
      } else {
        throw error;
      }
    }
  }

  // Добавляем оставшиеся стикеры по группам (строками по 8 стикеров)
  console.log('Добавление оставшихся стикеров...');
  let currentIndex = 0;
  while (currentIndex < stickersPng.length) {
    const group = stickersPng.slice(currentIndex, currentIndex + cols);
    for (let j = 0; j < group.length; j++) {
      try {
        await addStickerToSetWithRetry(group[j]);
      } catch (err) {
        console.error(`Ошибка при добавлении стикера (позиция ${j + 1} в группе):`, err.message);
      }
      await sleep(800);
    }
    currentIndex += group.length;
  }
  console.log('Все стикеры добавлены.');

  // Получаем готовый набор и формируем custom_emoji_id для отправки сообщения
  const stickerSet = await ctx.telegram.getStickerSet(setName);
  const orderedEmojiIds = stickerSet.stickers.map(sticker => sticker.custom_emoji_id);
  console.log('Порядок стикеров получен.');

  const stickerPackLink = `https://t.me/addstickers/${setName}`;
  await ctx.telegram.editMessageText(
    ctx.chat.id,
    job.progressMessage.message_id,
    undefined,
    `Эмодзи пак "${displayTitle}" успешно создан!\nСсылка: ${stickerPackLink}\nСтикеры будут отправлены от вашего имени.`
  );

  // Ждём и получаем пользовательского клиента для отправки итогового сообщения
  const userClient = await require('./userClient');
  const targetUsername = '@' + (ctx.from.username || ctx.from.first_name);
  let messageStr = "";
  for (let r = 0; r < rows; r++) {
    let rowStr = "";
    for (let c = 0; c < cols; c++) {
      const index = r * cols + c;
      if (!orderedEmojiIds[index]) continue;
      rowStr += `<tg-emoji emoji-id="${orderedEmojiIds[index]}">🧩</tg-emoji>`;
    }
    messageStr += rowStr + "\n";
  }
  await userClient.sendMessage(targetUsername, { message: messageStr });
  console.log("Сообщение отправлено.");
}

module.exports = { jobQueue, processPhotoJob };
