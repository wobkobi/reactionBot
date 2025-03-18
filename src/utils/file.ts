import fs from "fs";
import path from "path";

export function loadData(guildId: string, filename: string): any {
  const directory = path.join("data", guildId);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, {recursive: true});
  }
  const filepath = path.join(directory, filename);
  if (fs.existsSync(filepath)) {
    try {
      const data = fs.readFileSync(filepath, "utf8");
      return JSON.parse(data);
    } catch (error) {
      console.error("Error parsing JSON", error);
      return {};
    }
  }
  return {};
}

export function saveData(guildId: string, filename: string, data: any): void {
  const directory = path.join("data", guildId);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, {recursive: true});
  }
  const filepath = path.join(directory, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}
