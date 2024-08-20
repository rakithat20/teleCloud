import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import input from "input"; 
import express, { json } from 'express';
import morgan from 'morgan';
import dotenv from 'dotenv';
import multer from 'multer';
import fs from 'fs';
import { CustomFile } from "telegram/client/uploads.js"; 
import { constants } from "buffer";
import cors from 'cors'

dotenv.config();
const upload = multer({ storage: multer.memoryStorage() });

const app = express();
app.use(cors())
const port = 3000;
let session ;
const apiId = Number(process.env.apiId);
const apiHash = process.env.apiHash;
session = process.env.session;

const stringSession = new StringSession(session); 

const JSON_FILE = "files.json";
let dataObj = [];
const maxChunkSize = 5*1024*1024;
const maxFileSize = 10*1024*1024;

function dataObjResfresh(){
  try {
    const jsonData = fs.readFileSync(JSON_FILE);
    dataObj = JSON.parse(jsonData);
  } catch (error) {
    console.error("Error reading JSON file:", error);
  }
}
dataObjResfresh();

const handleLargeFiles = (fileBuffer) => {
  const countChunks = Math.ceil(fileBuffer.length / maxChunkSize);
  console.log(countChunks);
  let buffArray = [];

  for (let i = 0; i < countChunks; i++) {
    let start = i * maxChunkSize;
    let end = Math.min(start + maxChunkSize, fileBuffer.length);
    let chunk = fileBuffer.slice(start, end);
    buffArray.push(chunk);
  }
  return buffArray;
};

app.use(morgan('combined'));
app.use(express.json());


app.listen(port, async () => {
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  let phoneNumber;
  let resolveOtpPromise;
  let otpPromise = new Promise(resolve => resolveOtpPromise = resolve);

  // await client.start({
  //   phoneNumber: async () => await input.text("Please enter your number: "),
  //   password: async () => await input.text("Please enter your password: "),
  //   phoneCode: async () => await input.text("Please enter the code you received: "),
  //   onError: (err) => console.log(err),
  // });


  app.post('/login',async(req,res)=>{
    phoneNumber = req.body.pnumber;
    try {
      await client.start({
        phoneNumber: async () => phoneNumber,
        phoneCode: async () => {
          res.send(200)
          const otp = await otpPromise;
          return otp;
        },
        onError: (err) => console.log(err),
      });
      console.log("You are now connected.");
      
    } catch (error) {
      console.error(error);
      res.status(500).send("Error during login.");
    }
  });

  
  app.post('/login/verify',async(req,res)=>{
    const otp = req.body.otp;
    resolveOtpPromise(otp);
    otpPromise = new Promise(resolve => resolveOtpPromise = resolve); // Reset the promise for future logins
    console.log("You should now be connected.");
    session = client.session.save();
    
    res.send(session);

  });
   
  app.post('/upload', upload.single('file'), async (req, res) => {
    let file = req.file;
    await client.connect();
    const fileInfoArr = [];
    if (file.size > maxFileSize) {
      let buffArr = handleLargeFiles(file.buffer);
      const fileInfo = {
        originalFileName: file.originalname,
        mimeType: file.mimetype,
        uploadDate: new Date().toISOString(),
        parts: []
      };

      for (let i = 0; i < buffArr.length; i++) {
        const toUpload = new CustomFile(
          file.originalname + `(${i})`,
          buffArr[i].length,
          file.originalname + `(${i})`,
          buffArr[i]
        );
        const newfile = await client.uploadFile({
          file: toUpload,
          workers: 10,
        });

        let sent = await client.invoke(
          new Api.messages.SendMedia({
            peer: 'me',
            media: newfile,
            message: file.originalname + `(${i})`,
          })
        );

        const partInfo = {
          id: sent.updates[0].id,
          fileName: newfile.name,
          fileSize: buffArr[i].length,
          parts: newfile.parts
        };

        fileInfo.parts.push(partInfo);
      }
      dataObj.push(fileInfo);
      fs.writeFileSync(JSON_FILE, JSON.stringify(dataObj, null, 2));
      console.log(fileInfoArr);
    } else {
      const toUpload = new CustomFile(file.originalname, file.size, file.originalname, file.buffer);
      const newfile = await client.uploadFile({
        file: toUpload,
        workers: 10
      });
      let sent = await client.invoke(new Api.messages.SendMedia({
        peer: 'me',
        media: newfile,
        message: file.originalname
      }));

      const fileInfo = {
        id: sent.updates[0].id,
        fileName: newfile.name,
        fileSize: file.size,
        parts: newfile.parts,
        uploadDate: new Date().toISOString(),
        mimeType: file.mimetype
      };

      dataObj.push(fileInfo);
      fs.writeFileSync(JSON_FILE, JSON.stringify(dataObj, null, 2));
    }

    dataObjResfresh();
    req.file.buffer = null;
    res.sendStatus(200);
  });
  
  function regex(filename) {
    // Regex to match "(number)" at the end of the filename before any extension
    const regex = /\(\d+\)$/;
    // Replace the matched pattern with an empty string
    return filename.replace(regex, '');
  }

  app.get('/download/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      console.log(id);
  
      const data = dataObj.find(data => data.id === id || (Array.isArray(data.parts) && data.parts.some(part => part.id == id)));
      if (data) {
        const isMultiPart = Array.isArray(data.parts);
        const msg = await client.getMessages("me", { ids: id });
        if (msg.length > 0) {
          const media = msg[0].media;
          const fileName = msg[0].message;
          console.log(fileName);
  
          if (media) {
            if (isMultiPart) {
              const buffers = await handleMultiDown(data.parts);
              const combinedBuffer = Buffer.concat(buffers);
              res.set('Content-Type', media.document.mimeType);
              res.attachment(regex(fileName));
              res.send(combinedBuffer);
            } else {
              const buffer = await client.downloadMedia(media, { workers: 1 });
              res.set('Content-Type', media.document.mimeType);
              res.attachment(regex(fileName));
              res.send(buffer);
            }
          } else {
            res.status(404).send('Media not found');
          }
        } else {
          res.status(404).send('Message not found');
        }
      } else {
        res.status(404).send('Data not found');
      }
    } catch (error) {
      console.error(error);
      res.status(500).send('Internal server error');
    }
});

const handleMultiDown = async (parts) => {
  const largeBufferArr = [];
  for (const part of parts) {
    const msg = await client.getMessages("me", { ids: part.id });
    if (msg.length > 0) {
      const media = msg[0].media;
      if (media) {
        const buffer = await client.downloadMedia(media, { workers: 1 });
        largeBufferArr.push(buffer);
      }
    }
  }
  return largeBufferArr;
};

  app.delete('/delete/:id',async (req,res)=>{
    const idToDel = parseInt(req.params.id)
    let found = false;
    let i = 0;
    let allIds = []
    const data = dataObj.find(data => data.id === idToDel || (Array.isArray(data.parts) && data.parts.some(part => part.id == idToDel)));
    let dataObjindex = dataObj.indexOf(data);
    if(data){
      let first= data.parts[0].id;
      let last = data.parts[(data.parts.length-1)].id;
      while(first<=last){
      allIds.push(first++)
      const result= await client.invoke(new Api.messages.DeleteMessages({
        revoke:true,
        id:allIds,
      }))
      dataObj.splice(dataObjindex,1);
      fs.writeFileSync(JSON_FILE,JSON.stringify(dataObj,null,2));
      found = true
    }

    }
    
    for(let file of dataObj){
      
      if(file.id == idToDel){
        const result = await client.invoke(new Api.messages.DeleteMessages({
          revoke:true,
          id:[idToDel]
        }));
        
        if(result.ptsCount>0){
          found = true;
          dataObj.splice(i,1);
          fs.writeFileSync(JSON_FILE, JSON.stringify(dataObj, null, 2)); 
          dataObjResfresh();
        }
      }
      i++
    }
    if(found === true){
      res.send(200)
    }else{
      res.send(404)
    }

  })


  app.get('/files',async(req,res)=>{
    let files = dataObj;
    res.send(files);
  })
  app.get('/files/:search',(req,res)=>{
    const search = req.params.search;
    let items = dataObj.filter(file=>file.fileName.includes(search))
    res.send(items)
  })





});
export default app;