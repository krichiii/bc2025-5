import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { Command } from 'commander';
import superagent from 'superagent';

// --- 1. Обробка аргументів командного рядка ---
const program = new Command();
program
  .requiredOption('-h, --host <host>', 'адреса сервера')
  .requiredOption('-p, --port <port>', 'порт сервера')
  .requiredOption('-c, --cache <path>', 'шлях до директорії кешу')
  .configureOutput({
    outputError: (str, write) => {
      switch(true)
      {
        case (str.includes('--host')): 
          write('please specify server host\n')
          break
        case (str.includes('--port')):
          write('please specify server port\n')
          break
        default:
          write(str);
      }
    }
  });
program.parse(process.argv);
const options = program.opts();

// --- 2. Перевірка наявності директорії кешу ---
const cacheDir = path.resolve(options.cache);
const ensureCacheDir = async () => {
  try {
    await fs.access(cacheDir);
  } catch {
    await fs.mkdir(cacheDir, { recursive: true });
    console.log(`✅ Створено теку кешу: ${cacheDir}`);
  }
};

// --- 3. Функції для роботи з кешем ---
async function getCachedFile(code) {
  const filePath = path.join(cacheDir, `${code}.jpg`);
  try {
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}

async function saveCachedFile(code, data) {
  const filePath = path.join(cacheDir, `${code}.jpg`);
  await fs.writeFile(filePath, data);
}

async function deleteCachedFile(code) {
  const filePath = path.join(cacheDir, `${code}.jpg`);
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

// --- 4. Основна логіка проксі-сервера ---
const server = http.createServer(async (req, res) => {
  const method = req.method;
  const code = req.url.replace('/', '').trim();

  // ігноруємо запити без коду (наприклад /favicon.ico)
  if (!code || isNaN(code)) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    return res.end('Bad request: вкажіть HTTP код у URL, наприклад /200');
  }

  const filePath = path.join(cacheDir, `${code}.jpg`);

  try {
    switch (method) {
      // --- GET ---
      case 'GET': {
        let image = await getCachedFile(code);
        if (!image) {
          // Якщо нема в кеші — отримати з http.cat
          try {
            const response = await superagent.get(`https://http.cat/${code}`);
            image = response.body;
            await saveCachedFile(code, image);
            console.log(`📥 Завантажено з http.cat і кешовано: ${code}`);
          } catch {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end('Not Found');
          }
        }
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        res.end(image);
        break;
      }

      // --- PUT ---
      case 'PUT': {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const data = Buffer.concat(chunks);
        await saveCachedFile(code, data);
        res.writeHead(201, { 'Content-Type': 'text/plain' });
        res.end('Created');
        break;
      }

      // --- DELETE ---
      case 'DELETE': {
        const deleted = await deleteCachedFile(code);
        if (deleted) {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('Deleted');
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
        }
        break;
      }

      // --- Інші методи ---
      default:
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method Not Allowed');
    }
  } catch (err) {
    console.error('❌ Помилка сервера:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
});

// --- 5. Запуск сервера ---
await ensureCacheDir();
server.listen(options.port, options.host, () => {
  console.log(`🚀 Сервер запущено на http://${options.host}:${options.port}`);
});
