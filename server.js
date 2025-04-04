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
  origin: "https://waste-management-sand.vercel.app/", 
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
                  text: `You are a waste classification assistant. Based on the image provided, identify the primary object (e.g., 'Plastic Bottle'). Classify the given waste item image into one of the following categories: "Dry", "Wet", "Electronics", or "Medical". If the item is not related to waste or cannot be classified under these categories, set "classification": "NA" and write "NA" for all fields in general_solution. Return the result in the following JSON structure:

{
  "prediction": {
    "ITEM_NAME": {
      "classification": "Dry Waste | Wet Waste | Electronics Waste | Medical Waste | NA",
      "general_solution": {
        "disposal": "string or NA",
        "benefits": "string or NA",
        "tips": "string or NA",
        "impact": "string or NA",
        "alternatives": "string or NA",
        "additional_resources": "string or NA"
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
