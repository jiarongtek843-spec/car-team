import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { ValidationError } from "./errors.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

// 本地磁盘存储，简单可靠，符合公司内部系统的规模。部署到 Railway 时需要挂载
// persistent volume 指向这个目录，否则重新部署会遗失已上传的图片（见已知限制）。
export const uploadsRoot = path.resolve(currentDir, "../../uploads");

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

function createImageUpload(subfolder: string) {
  const dir = path.join(uploadsRoot, subfolder);
  fs.mkdirSync(dir, { recursive: true });

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    }
  });

  return multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE_BYTES },
    fileFilter: (_req, file, cb) => {
      if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        cb(new ValidationError("只允许上传 JPEG/PNG/WEBP 格式的图片"));
        return;
      }
      cb(null, true);
    }
  });
}

export const collectionProofUpload = createImageUpload("collections");

export function collectionProofImageUrl(filename: string) {
  return `/uploads/collections/${filename}`;
}
