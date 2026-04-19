
import fs from "fs";
import path from "path";

const logPath = path.join(process.cwd(), "logs/app.log");
const logStream = fs.createWriteStream(logPath, { flags: "a" });

function writeLog(type: string, args: any[]) {
    const msg =
        `[${new Date().toISOString()}] [${type}] ` +
        args.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") +
        "\n";

    logStream.write(msg);
}

// Override console
console.log = (...args) => writeLog("LOG", args);
console.error = (...args) => writeLog("ERROR", args);
console.warn = (...args) => writeLog("WARN", args);

// Catch crashes
process.on("uncaughtException", (err) => {
    writeLog("FATAL", [err.stack || err.message]);
});

process.on("unhandledRejection", (err: any) => {
    writeLog("PROMISE_REJECTION", [err?.stack || err]);
});
