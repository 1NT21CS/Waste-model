require("dotenv").config();
const express = require("express");
const multer = require("multer");
const { Storage } = require("@google-cloud/storage");
const { InferenceClient } = require("@huggingface/inference");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const app = express();
const port = 3000;

app.use(cors({
  origin: "http://localhost:5173", // or your deployed frontend URL
}));

// Multer setup
const upload = multer({ storage: multer.memoryStorage() });

// GCS setup
const decodedKey = Buffer.from(process.env.GCLOUD_KEY_BASE64, "base64").toString("utf-8");
const keyPath = path.join(__dirname, "temp-gcloud-key.json");
fs.writeFileSync(keyPath, decodedKey);
const storage = new Storage({ keyFilename: keyPath });
const bucketName = "waste-management-photos";
const bucket = storage.bucket(bucketName);

// HuggingFace setup
const hf = new InferenceClient(process.env.HF_TOKEN);

// Upload and describe endpoint
app.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const blob = bucket.file(req.file.originalname);
  const blobStream = blob.createWriteStream({
    resumable: false,
    metadata: {
      contentType: req.file.mimetype,
    },
  });

  blobStream.on("error", (err) =>
    res.status(500).json({ error: err.message })
  );

  blobStream.on("finish", async () => {
    const publicUrl = `https://storage.googleapis.com/${bucketName}/${blob.name}`;

    try {
        const chatCompletion = await hf.chatCompletion({
          provider: "nebius",
          model: "google/gemma-3-27b-it",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `You are a waste classification assistant. Based on the image provided, identify the primary object (e.g., 'Plastic Bottle'), and return a JSON object in the following format:

{
  "prediction": {
    "<object name>": {
      "classification": "<Biodegradable | Non-Biodegradable | Recyclable>",
      "general_solution": {
        "disposal": "<How to dispose it>",
        "benefits": "<Environmental or economic benefits>",
        "tips": "<Helpful usage or disposal tips>",
        "impact": "<How it affects the environment>",
        "alternatives": "<Better alternatives if any>",
        "additional_resources": "<A helpful link or article>"
      }
    }
  }
}

Only return the JSON object.`,
                },
                {
                  type: "image_url",
                  image_url: { url: publicUrl },
                },
              ],
            },
          ],
          max_tokens: 500,
        });
        let rawContent = chatCompletion.choices[0].message.content || "";

        // Extract JSON from markdown-style code block
        const jsonMatch = rawContent.match(/```json\s*([\s\S]*?)\s*```/);
        if (!jsonMatch) {
          return res.status(500).json({ error: "Model response is not valid JSON." });
        }
        
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          await blob.delete(); // Delete the uploaded image
          res.json(parsed); // Send structured JSON response
        } catch (err) {
          res.status(500).json({ error: "Failed to parse JSON from model.", details: err });
        }
        // or also return publicUrl if needed
      } catch (err) {
        res.status(500).json({ error: "Failed to process image", details: err });
      }
  });

  blobStream.end(req.file.buffer);
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
