// userClient.js
const fs = require('fs');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');
require('dotenv').config();

const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH;
const sessionFilePath = './session.txt';

let clientPromise = (async () => {
  let stringSession = new StringSession('');
  if (fs.existsSync(sessionFilePath)) {
    const sessionData = fs.readFileSync(sessionFilePath, 'utf-8');
    stringSession = new StringSession(sessionData);
    console.log('Сессия загружена из файла.');
  }
  console.log('Запуск пользовательского клиента...');
  const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });
  try {
    await client.start({
      phoneNumber: async () => await input.text('Введите номер телефона:'),
      password: async () => await input.text('Введите пароль (если включена 2FA):'),
      phoneCode: async () => await input.text('Введите код из Telegram:'),
    });
    fs.writeFileSync(sessionFilePath, client.session.save());
    console.log('Сессия успешно сохранена.');
  } catch (err) {
    console.error('Ошибка запуска клиента:', err.message);
    process.exit(1);
  }
  client.setParseMode('html');
  return client;
})();

module.exports = clientPromise;
