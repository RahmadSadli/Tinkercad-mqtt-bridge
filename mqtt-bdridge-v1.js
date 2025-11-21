/**
 * mqtt-bridge-v1.js — Tinkercad Serial ↔ MQTT Bridge
 * ---------------------------------------------------
 * Developed by: Rahmad Sadli
 *
 * Description:
 *  - Reads real-time serial data from a Tinkercad circuit simulation
 *  - Publishes parsed readings (temperature, intensity) to MQTT topics
 *  - Subscribes to MQTT commands (sensor/command) and sends them back
 *    to the Tinkercad Serial Monitor input field.
 *
 * Usage:
 *   node mqtt-bridge-v1.js "https://www.tinkercad.com/things/<YourCircuit>" [broker=localhost] [port=1883]
 *
 * MQTT Topics:
 *  Accept all topics from Tinkercad
 *  Limited topic to send to Tinkercad only can be used for sensor/command
 *
 * ©2025rahmadsadli. All rights reserved.
 */


const [,, URL, BROKER = "localhost", PORT = "1883"] = process.argv;
if (!URL) {
  console.error('Usage: node mqtt-bridge_v2.js "<tinkercad-url>" [broker] [port]');
  process.exit(1);
}

const mqtt = require("mqtt");
const puppeteer = require("puppeteer");
const { execSync } = require("child_process");

(async () => {
  // --- Detect Chrome ---
  let chromePath;
  try {
    const out = execSync(
      'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe" /ve'
    ).toString();
    chromePath = out.match(/REG_SZ\s+(.*)/)[1].trim();
    console.log("✔ Detected Chrome:", chromePath);
  } catch {
    console.log("⚠️  Chrome not found, using Puppeteer Chromium.");
  }

  // --- MQTT setup ---
  const client = mqtt.connect(`mqtt://${BROKER}:${PORT}`);
  client.on("connect", () => {
    console.log(`✔ MQTT connected → ${BROKER}:${PORT}`);
    //console.log("📡 Publishing: sensor/temperature, sensor/intensity");
    //console.log("📥 Listening for: sensor/command");
    client.subscribe("sensor/command");
  });

  client.on("error", e => console.error("MQTT error:", e.message));

  // --- Launch Chrome ---
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: chromePath || undefined,
    defaultViewport: null,
    args: [
      "--start-maximized",
      "--ignore-certificate-errors",
      "--disable-blink-features=AutomationControlled"
    ]
  });

  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  console.log("🌐 Opening Tinkercad...");
  await page.goto(URL, { waitUntil: "networkidle2" });
  console.log("➡️  Log in if needed, click **Start Simulation**, and open the **Serial Monitor**.");

  // --- Serial output polling ---
  let lastData = "";

  setInterval(async () => {
    try {
      const text = await page.evaluate(() =>
        (document.body && document.body.innerText) || ""
      );

      if (!text || text === lastData) return;
      lastData = text;

      const lines = text.split(/\r?\n/).slice(-10);

      for (const line of lines) {
        if (!line.trim()) continue;

        const parts = line.trim().split(/\s+/);
        if (parts.length < 2) continue; // invalid line format

        const topic = parts[0];               // everything before first space
        const payload = parts.slice(1).join(" "); // everything after topic

        console.log("→ publish:", topic, payload);
        client.publish(topic, payload);
      }

    } catch (err) {
      console.error("poll error:", err.message);
    }
  }, 200);


  // --- Forward ALL MQTT messages to Serial Monitor ---
client.on("message", async (topic, message) => {
  const msg = message.toString();
  console.log(`← MQTT: ${topic} ${msg}`);

  try {
    const frames = await page.frames();
    let sent = false;

    // Find the main Tinkercad editor frame
    const targetFrame = frames.find(f =>
      f.url().includes("/editel")
    );

    if (!targetFrame) {
      console.log("⚠️ Could not locate the Tinkercad editor frame.");
      return;
    }

    // Get all possible text inputs (Serial Monitor is usually the last one)
    const textInputs = await targetFrame.$$("textarea, input[type='text']");
    if (textInputs.length > 0) {
      const serialInput = textInputs[textInputs.length - 1]; // likely serial monitor
      await serialInput.click({ clickCount: 3 });
      await page.keyboard.press("Backspace");
      await serialInput.type(msg);
      await page.keyboard.press("Enter");

      console.log(`↩ Sent to Tinkercad Serial: "${msg}"`);
      sent = true;
    }

    if (!sent) {
      console.log("⚠️ Serial input box not found — please keep Serial Monitor open.");
    }
  } catch (err) {
    console.error("⚠️ Error sending to Tinkercad serial:", err.message);
  }
});
})();
