// index.js
const { Telegraf } = require('telegraf');
require('dotenv').config();
const { jobQueue } = require('./queueManager');

// Глобальное множество для проверки повторной обработки file_id (если требуется)
const processedFileIds = new Set();

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PORT = process.env.PORT || 8000;

const bot = new Telegraf(BOT_TOKEN);
let botUsername = null;

bot.telegram.getMe().then((me) => {
  botUsername = me.username.toLowerCase();
  console.log(`Bot username: ${botUsername}`);
}).catch(console.error);

bot.start((ctx) => {
  ctx.reply(
    'Привет! Отправь фотографию с подписью (название пака).\n\n' +
    'Эмодзи пак может содержать не более 200 стикеров (каждый 100×100 пикселей).'
  );
});

// Обработка полученного фото
bot.on('photo', async (ctx) => {
  try {
    console.log('Получено фото от пользователя', ctx.from.id);
    // Выбираем фото с наивысшим разрешением
    const photoSizes = ctx.message.photo;
    const highestResPhoto = photoSizes[photoSizes.length - 1];

    // Проверка по file_id: если фото уже обрабатывалось ранее, не добавляем в очередь
    if (processedFileIds.has(highestResPhoto.file_id)) {
      console.log(`Фото с file_id ${highestResPhoto.file_id} уже обработано, повторная обработка пропущена.`);
      return;
    }
    processedFileIds.add(highestResPhoto.file_id);

    const packTitle = ctx.message.caption || 'Без названия';

    // Создаём объект задания
    const job = {
      ctx,
      fileId: highestResPhoto.file_id,
      photo: highestResPhoto,
      caption: packTitle,
      userId: ctx.from.id,
      botUsername,
      // progressMessage будет добавлено после отправки прогресс-сообщения
      progressMessage: null,
      // Дополнительные поля для расчёта (например, интервалы обновления)
    };

    // Добавляем задание в глобальную очередь
    await jobQueue.addJob(job);
  } catch (err) {
    console.error('Ошибка при получении фото:', err);
    ctx.reply('❌ Произошла ошибка при получении фото.');
  }
});

// ================= Webhook =================
const webhookPath = `/bot${BOT_TOKEN}`;
bot.telegram.setWebhook(`${WEBHOOK_URL}${webhookPath}`)
  .then(() => console.log('Webhook установлен:', `${WEBHOOK_URL}${webhookPath}`))
  .catch(console.error);

bot.startWebhook(webhookPath, null, PORT, () => {
  console.log(`Бот слушает на порту ${PORT}`);
});

process.once('SIGINT', () => { bot.stop('SIGINT'); process.exit(0); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); process.exit(0); });
