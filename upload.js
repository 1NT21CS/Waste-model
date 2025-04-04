const express = require('express');
const multer = require('multer');
const { Storage } = require('@google-cloud/storage');

const app = express();
const port = 3000;

// Multer setup (store file in memory before uploading)
const upload = multer({ storage: multer.memoryStorage() });

// Initialize Google Cloud Storage
const storage = new Storage({ keyFilename: './gcloud-key.json' });
const bucketName = 'waste-management-photos';
const bucket = storage.bucket(bucketName);

// API Route to handle file uploads
app.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const blob = bucket.file(req.file.originalname);
  const blobStream = blob.createWriteStream({
    resumable: false,
    metadata: {
      contentType: req.file.mimetype,
    },
  });

  blobStream.on('error', (err) => res.status(500).json({ error: err.message }));

  blobStream.on('finish', () => {
    const publicUrl = `https://storage.googleapis.com/${bucketName}/${blob.name}`;
    res.json({ message: 'File uploaded successfully', url: publicUrl });
  });

  blobStream.end(req.file.buffer);
});

app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
