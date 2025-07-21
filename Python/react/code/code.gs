// --- CONFIGURATION ---
// Google Sheet where your FAQs are stored (replace with your Sheet ID)
const FAQ_SHEET_ID = "1J8J05x9tflT29-kdEG3NHUKtO9FHN4e_geh6KVQfm-Y"; // <--- Update this
const FAQ_SHEET_NAME = "FAQs"; // Name of the sheet tab, e.g., "Sheet1" or "FAQs"
const FAQ_QUESTION_COL = 0; // Column index for questions/keywords (0-indexed, so A=0, B=1)
const FAQ_ANSWER_COL = 1;   // Column index for answers (0-indexed)
const FAQ_LINK_COL = 2;     // Column index for links (0-indexed)

// Gemini API settings
const GEMINI_MODEL = "gemini-1.5-flash"; // Or "gemini-1.5-pro"
const GEMINI_API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');

// --- Core Web App Functions ---

// doGet handles GET requests and serves the Index.html file as the frontend
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle('PforSST Chatbot')
      .setFaviconUrl('https://www.sst.edu.sg/favicon.ico') // Optional: Add a favicon
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

// This function is called directly by google.script.run from the frontend
function processChatRequest(userQuery) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000); // Wait up to 30 seconds for the lock

  try {
    if (!userQuery) {
      Logger.log("processChatRequest: No user query provided.");
      return { error: "No message provided." }; // Return an error object
    }

    Logger.log(`processChatRequest: Received query: ${userQuery}`);

    const faqs = getFaqsFromSheet(); // Load FAQs
    const response = getGeminiResponse(userQuery, faqs);

    return response; // Return the full response object to the frontend

  } catch (error) {
    Logger.log(`Error in processChatRequest: ${error.message}`);
    return {
      error: "An error occurred on the server.",
      details: error.message
    };
  } finally {
    lock.releaseLock();
  }
}

// --- Helper Functions (remain the same as previous corrections) ---

// Function to get FAQs from Google Sheet
function getFaqsFromSheet() {
  try {
    const sheet = SpreadsheetApp.openById(FAQ_SHEET_ID).getSheetByName(FAQ_SHEET_NAME);
    if (!sheet) {
      throw new Error(`Sheet with name "${FAQ_SHEET_NAME}" not found.`);
    }
    const range = sheet.getDataRange();
    const values = range.getValues();
    return values.slice(1); // Assuming first row is header
  } catch (e) {
    Logger.log(`Error reading FAQ sheet: ${e.message}`);
    return [];
  }
}

// Function to construct the prompt and call Gemini API
function getGeminiResponse(userQuery, faqs) {
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  let prompt = `
  You are the PforSST Parent Support AI Agent for the School of Science and Technology Singapore (SST).
  Your role is to interact with parents, address their inquiries, and provide assistance with common support topics.

  **Instructions:**
  - Maintain a friendly, clear, and professional tone.
  - Keep responses brief and to the point.
  - Answer questions accurately using the provided FAQs and context.
  - If an answer from the FAQ includes a link, always include that exact link in your response.
  - If you cannot find a direct, confident answer in the provided FAQs, or if the query is too complex/sensitive, state that you are unable to assist with that specific query and mark for human escalation. Do not guess or speculate.
  - Do NOT request or store any personal data. Advise parents against sharing sensitive information.
  - Do NOT mention that you are an AI model or a language model unless explicitly asked.

  **PforSST FAQs (Use this knowledge base to answer questions):**
  `;

  if (faqs.length > 0) {
    faqs.forEach(row => {
      const question = row[FAQ_QUESTION_COL] || "N/A";
      const answer = row[FAQ_ANSWER_COL] || "N/A";
      const link = row[FAQ_LINK_COL] || "";

      prompt += `\n- Q: ${question}\n  A: ${answer}`;
      if (link) {
        prompt += ` (More details: ${link.trim()} )`;
      }
    });
  } else {
    prompt += "\nNo FAQs loaded. Relying on general knowledge for simple queries, but may escalate more often.";
  }

  prompt += `\n\n**Parent's Query:**\n${userQuery}\n\n**Your Response (Start with "Hi there!" or similar friendly greeting. If escalating, clearly state the need to contact PforSST exco. Do not include any sign-off like "Best regards, PforSST".):**`;

  const requestBody = {
    contents: [{
      parts: [{
        text: prompt
      }]
    }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 500
    }
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true
  };

  let responseText = "";
  let escalate = false;

  try {
    const response = UrlFetchApp.fetch(apiUrl, options);
    const responseCode = response.getResponseCode();
    const responseJson = JSON.parse(response.getContentText());

    if (responseCode === 200) {
      if (responseJson.candidates && responseJson.candidates.length > 0) {
        responseText = responseJson.candidates[0].content.parts[0].text.trim();
        if (responseText.toLowerCase().includes("unable to assist") ||
            responseText.toLowerCase().includes("contact exco member") ||
            responseText.toLowerCase().includes("beyond my capabilities") ||
            responseText.toLowerCase().includes("complex or sensitive")) {
            escalate = true;
        }
      } else {
        Logger.log("Gemini API response contained no candidates.");
        responseText = "I'm sorry, I couldn't generate a response for your query.";
        escalate = true;
      }
    } else {
      Logger.log(`Gemini API error: ${responseCode} - ${response.getContentText()}`);
      responseText = `I'm sorry, I encountered an internal error while processing your request. Error details: ${responseJson.error ? responseJson.error.message : 'Unknown API error.'}`;
      escalate = true;
    }
  } catch (e) {
    Logger.log(`Exception when calling Gemini API: ${e.message}`);
    responseText = "I'm sorry, I encountered a technical issue and couldn't process your request. Please try again later or contact a PforSST exco member.";
    escalate = true;
  }

  return {
    response: responseText,
    escalate: escalate
  };
}
