/* global Buffer, console */
import { readFileSync } from "node:fs";
import { createServer as tlsServer } from "node:tls";
import { createServer as httpServer } from "node:http";

// Isolated test sink: accepts mail locally and never relays to external recipients.
const messages = [];
const password = readFileSync("/run/secrets/smtp_password", "utf8").trim();
tlsServer({ key: readFileSync("/run/secrets/smtp_test_key"), cert: readFileSync("/run/secrets/smtp_test_cert"), minVersion: "TLSv1.2" }, (socket) => {
  socket.setEncoding("utf8");
  socket.on("error", () => {});
  let buffer = "", data = false, lines = [], authenticated = false;
  socket.write("220 smtp-test ESMTP ready\r\n");
  socket.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 2);
      if (data) {
        if (line === ".") { messages.push(lines.join("\r\n")); lines = []; data = false; socket.write("250 2.0.0 accepted\r\n"); }
        else lines.push(line.replace(/^\.\./, "."));
      } else if (/^EHLO|^HELO/i.test(line)) socket.write("250-smtp-test\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n");
      else if (/^AUTH PLAIN /i.test(line)) {
        const [, user, pass] = Buffer.from(line.slice(11), "base64").toString().split("\0");
        authenticated = user === "sender@example.test" && pass === password;
        socket.write(authenticated ? "235 2.7.0 authenticated\r\n" : "535 5.7.8 denied\r\n");
      } else if (/^QUIT/i.test(line)) socket.end("221 bye\r\n");
      else if (!authenticated) socket.write("530 authentication required\r\n");
      else if (/^DATA$/i.test(line)) { data = true; socket.write("354 end with dot\r\n"); }
      else socket.write("250 ok\r\n");
    }
  });
}).listen(465, "0.0.0.0", () => console.log("Local test SMTP ready; external delivery disabled."));
httpServer((_request, response) => { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(messages)); }).listen(8080, "0.0.0.0");

// Fake AI endpoints used only by the smoke network; requests never leave Docker.
import { createServer as httpsServer } from "node:https";
httpsServer({ key: readFileSync("/run/secrets/smtp_test_key"), cert: readFileSync("/run/secrets/smtp_test_cert") }, (request, response) => {
  response.setHeader("Content-Type", "application/json");
  let body = "";
  request.on("data", (chunk) => { if (!request.url.includes("audio/transcriptions")) body += chunk; });
  request.on("end", () => {
    if (request.url.includes("audio/transcriptions")) {
      response.end(JSON.stringify({ segments: [{ start: 0, end: 3, text: "这是 Docker 部署测试视频。" }] })); return;
    }
    try {
      const input = JSON.parse(body), source = JSON.parse(input.messages[1].content), segmentId = source.segments[0].id;
      const content = input.messages[0].content.includes("faithful study notes")
        ? { title: "部署测试笔记", topic: "容器联调", coreIdeas: ["验证完整处理流程"], sections: [{ id: "section-1", level: 1, title: "容器运行", body: "这是本地模拟 AI 生成的部署验收内容。", citations: [{ segmentId, timestampSeconds: 0 }] }], reviewPoints: ["联调已完成"] }
        : { oneLineSummary: "部署测试摘要", overallSummary: "这是部署验收视频。", chapters: [{ id: "chapter-1", title: "部署验收", sourceSegmentIds: [segmentId], summary: "验证容器处理视频。", bullets: [{ text: "联调内容", sourceSegmentIds: [segmentId] }] }] };
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
    } catch { response.statusCode = 400; response.end("{}"); }
  });
}).listen(443, "0.0.0.0");
