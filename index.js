import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import input from "input"; // npm i input
import express from 'express';
import morgan from 'morgan';
import dotenv from 'dotenv';
import multer from 'multer';
import fs from 'fs';
import { CustomFile } from "telegram/client/uploads.js"; // corrected import
import { constants } from "buffer";

dotenv.config();
const upload = multer({ storage: multer.memoryStorage() });

const app = express();
const port = 3000;
let session ;
const apiId = Number(process.env.apiId);
const apiHash = process.env.apiHash;
session = process.env.session;
const stringSession = new StringSession(session); 

const JSON_FILE = "files.json";
let dataObj = [];

try {
  const jsonData = fs.readFileSync(JSON_FILE);
  dataObj = JSON.parse(jsonData);
} catch (error) {
  console.error("Error reading JSON file:", error);
}

app.use(morgan('combined'));

app.listen(port, async () => {
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await input.text("Please enter your number: "),
    password: async () => await input.text("Please enter your password: "),
    phoneCode: async () => await input.text("Please enter the code you received: "),
    onError: (err) => console.log(err),
  });

  console.log("You should now be connected.");
  console.log(client.session.save());
  console.log(`Server started successfully on port: ${port}`);

  app.post('/upload', upload.single('file'), async (req, res) => {
    let file = req.file;
    await client.connect();

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

    res.sendStatus(200);
  });

  app.get('/download/:id', async (req, res) => {
    const msgs = await client.getMessages("me", { limit: 1 });
    console.log(msgs);

    const id = req.params.id;
    console.log(id);
    const msg = await client.getMessages("me", {
      ids: parseInt(id),
    });
    const media = msg[0].media;
    const fileName = msg[0].message;
    console.log(fileName);
    if (media) {
      const buffer = await client.downloadMedia(media, {
        workers: 1,
      });
      res.set('Content-Type', media.document.mimeType);
      res.attachment(fileName);
      res.send(buffer);
    }
  });
  app.delete('/delete/:id',async (req,res)=>{
    const idToDel = parseInt(req.params.id)
    let found = false;
    let i = 0;
    for(let file of dataObj){
      
      if(file.id == idToDel){
        const result = await client.invoke(new Api.messages.DeleteMessages({
          revoke:true,
          id:[idToDel]
        }));
        console.log(result)
        dataObj.splice(i,1);
        console.log(dataObj)
        fs.writeFileSync(JSON_FILE, JSON.stringify(dataObj, null, 2)); 
        if(result.ptsCount>0){
          found = true;
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
});
export default app;