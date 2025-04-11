const { spawn } = require('child_process');
const { mkdir } = require('fs');
const path = require('path');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

async function resizeVideoTo800x800(inputPath, outputPath,colorKey = null,similarity = 0.1) {
   
    return new Promise((res,rej)=>{
        const args = [
            '-i', inputPath,
            '-vf', `scale=800:800:force_original_aspect_ratio=decrease,pad=800:800:(ow-iw)/2:(oh-ih)/2:color=black@0,format=yuva420p`,
            '-c:v', 'libvpx-vp9', 
            '-pix_fmt', 'yuva420p',
            '-t', '3',       
            '-auto-alt-ref', '0',        
            '-b:v', '0',                 
            '-crf', '40',
            '-deadline', 'best',
            '-cpu-used', '4',               
            '-an',                       
            outputPath
          ];
        
          const ffmpeg = spawn('ffmpeg', args);
        
          ffmpeg.stdout.on('data', (data) => {
            console.log(`stdout: ${data}`);
          });
        
          ffmpeg.stderr.on('data', (data) => {
            console.error(`stderr: ${data}`);
          });
        
          ffmpeg.on('close', (code) => {
            if (code === 0) {
              console.log('✅ Видео успешно масштабировано и конвертировано в webm с альфаканалом!');
              res();
            } else {
              console.error(`❌ Процесс завершился с кодом ${code}`);
            }
          });
    })
   
  }


const chunkSize = 100;

async function getVideoDimensions(inputPath) {
  const { stdout } = await exec(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${inputPath}"`);
  const [width, height] = stdout.trim().split('x').map(Number);
  return { width, height };
}
function sortChunks(chunks) {
    return chunks.sort((a, b) => {
      // Извлекаем координаты X и Y из имён файлов
      const [x1, y1] = a.match(/chunk_(\d+)_(\d+)/).slice(1, 3).map(Number);
      const [x2, y2] = b.match(/chunk_(\d+)_(\d+)/).slice(1, 3).map(Number);
  
      // Сравниваем сначала по X, затем по Y
      if (x1 !== x2) {
        return x1 - x2;
      } else {
        return y1 - y2;
      }
    });
  }
async function cropVideoIntoChunks(inputPath,tempPath) {
  return new Promise(async (res,rej)=>{
    let chunks = []
    const { width: videoWidth, height: videoHeight } = await getVideoDimensions(inputPath);
  
    for (let y = 0; y < videoHeight; y += chunkSize) {
      for (let x = 0; x < videoWidth; x += chunkSize) {
        await new Promise((chunkCompleted)=>{
            const output = `${tempPath}chunk_${x}_${y}.webm`;
            const ffmpeg = spawn('ffmpeg', [
              '-i', inputPath,
              '-filter:v', `crop=${chunkSize}:${chunkSize}:${y}:${x}`,
              '-c:v', 'libvpx-vp9',  // используем кодек VP9 для хорошего качества и размера
              '-crf', '30',          // контроль качества (чем меньше, тем лучше качество)
              '-b:v', '0',           // для CRF режима битрейт 0
              '-an',                 // без звука
              output
            ]);
      
           
      
            ffmpeg.on('close', async (code) => {
              if (code === 0) {
                console.log(`Сохранен чанк: ${output}`);
                chunks.push(output);
                chunkCompleted();
              } else {
                
                console.error(`Ошибка при сохранении чанка: ${output}`);
              }
            });
        })
       
      }
    }

    res(sortChunks(chunks));
  })
 
}
async function getVideoChunks(tempPath,file,args){
    
    await resizeVideoTo800x800(`${tempPath}${file}`,`${tempPath}resized.webm`,args.chromo,args.similarity);
    let chunks = await cropVideoIntoChunks(`${tempPath}resized.webm`,tempPath);
    return chunks;
}
module.exports = {getVideoChunks}
// Пример использования:
// resizeVideoTo800x800('test2.MOV', 'output_resized.webm');
