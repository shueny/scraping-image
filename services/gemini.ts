import { GoogleGenAI } from "@google/genai";

const getAiClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key not found in environment variables");
  }
  return new GoogleGenAI({ apiKey });
};

export const summarizePropertyListing = async (text: string): Promise<string> => {
  try {
    const ai = getAiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `You are a real estate assistant. Please analyze the following scraped text from a property listing website. 
      Extract and summarize the following details in a clean, bulleted format:
      - Property Type & Size (Bedrooms, etc)
      - Location
      - Key Features/Amenities
      - Price (if available)
      - Sentiment/Vibe (Luxury, fixer-upper, etc.)

      Keep it concise (under 150 words).

      Raw Text:
      ${text}
      `,
    });
    
    return response.text || "No summary generated.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Failed to generate summary. Please check your API key or try again.";
  }
};
