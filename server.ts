import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";

dotenv.config();

const app = express();
const PORT = 3000;

// Set maximum body limits to support receipt image uploads
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ limit: "15mb", extended: true }));

// Server-side health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", app: "Finance Pilot" });
});

// Gemini-powered OCR Receipt Scanner endpoint
app.post("/api/ocr", async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ error: "No receipt image data provided" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ 
        error: "GEMINI_API_KEY environment variable is not configured. Please add it via the Settings > Secrets configuration in AI Studio." 
      });
    }

    // Lazy load the Gemini client safely
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });

    // Parse image mimetype and base64 string
    let mimeType = "image/jpeg";
    let base64Data = image;
    
    if (image.includes(";base64,")) {
      const parts = image.split(";base64,");
      mimeType = parts[0].replace("data:", "");
      base64Data = parts[1];
    }

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [
        {
          inlineData: {
            mimeType,
            data: base64Data,
          },
        },
        {
          text: "Analyze this receipt image and extract receipt details: merchant, date (formatted as YYYY-MM-DD), amount (float/number), category, and notes. The category MUST match one of these: Food & Dining, Groceries, Shopping, Rent & Housing, Utilities, Transportation, Entertainment, Health & Fitness, Travel, Education, Miscellaneous. Summarize purchased items or transaction purpose in notes.",
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            merchant: {
              type: Type.STRING,
              description: "The name of the store, merchant or payee on the receipt.",
            },
            date: {
              type: Type.STRING,
              description: "The receipt date in YYYY-MM-DD format. Use today's date if missing.",
            },
            amount: {
              type: Type.NUMBER,
              description: "The total amount paid, extracted as a floating-point number.",
            },
            category: {
              type: Type.STRING,
              description: "The category that best matches the receipt content from the approved list.",
            },
            notes: {
              type: Type.STRING,
              description: "A summary of items purchased or description of receipt details.",
            },
          },
          required: ["merchant", "date", "amount", "category", "notes"],
        },
      },
    });

    const ocrResultText = response.text;
    if (!ocrResultText) {
      return res.status(500).json({ error: "Gemini did not return any OCR result text" });
    }

    try {
      const result = JSON.parse(ocrResultText.trim());
      return res.json({ success: true, result });
    } catch (parseError) {
      console.error("Failed to parse Gemini OCR response as JSON:", ocrResultText);
      return res.status(500).json({ 
        error: "Failed to parse OCR results. Please make sure the image is a legible receipt.",
        rawText: ocrResultText 
      });
    }
  } catch (error: any) {
    console.error("Gemini OCR Server Error:", error);
    return res.status(500).json({ 
      error: error.message || "An error occurred while processing the receipt scanning." 
    });
  }
});

// Configure Vite integration
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting server in DEVELOPMENT mode with Vite middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting server in PRODUCTION mode with compiled static files...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Finance Pilot server listening at http://0.0.0.0:${PORT}`);
  });
}

startServer();
