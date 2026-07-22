import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { ValidationError } from "./errors.js";
import { getCompanySettings } from "../modules/companySettings/companySettings.service.js";
import { asyncHandler } from "./asyncHandler.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

// 本地磁盘存储，简单可靠，符合公司内部系统的规模。部署到 Railway 时需要挂载
// persistent volume 指向这个目录，否则重新部署会遗失已上传的图片（见已知限制）。
export const uploadsRoot = path.resolve(currentDir, "../../uploads");

// 存档名的副档名一律由这个白名单决定，绝对不要相信上传者填的原始档名——
// 原始档名/Content-Type 都是使用者可以任意伪造的（例如把一个 .html 档案伪装成
// Content-Type: image/jpeg 上传），如果直接采用使用者提供的副档名，伪装成功的
// 档案会被原样存到磁盘、被 express.static 用那个副档名的 Content-Type served 出去，
// 等于让任何登入的 Driver 都能在这个网站的网域下放一个 Stored XSS 页面。
const ALLOWED_MIME_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp"
};

// 对应的 magic number（文件签名），上传后再读一次实际内容比对，防止只伪造 Content-Type
// header 而实际内容不是图片的情况——fileFilter 那关只看 header，检查不了真正的档案内容。
const MAGIC_NUMBERS: { mime: string; bytes: number[] }[] = [
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] } // "RIFF"，WebP 在第 8 字节才是 "WEBP"，这里先用前缀粗筛
];

// multer 的 `limits.fileSize` 是在 router 注册时（模块载入时）就固定死的，没办法每个请求
// 动态读一次 DB。这里刻意设成「硬上限」（跟 companySettings.controller.ts 的 zod 校验
// maxUploadFileSizeMb 上限 20MB 一致），真正生效的、可从 Company Settings 调整的限制在
// 档案落盘、算完 magic number 之后另外检查一次（见 collectionProofUpload 的第二个 middleware）。
const HARD_CEILING_FILE_SIZE_BYTES = 20 * 1024 * 1024;

function matchesMagicNumber(buffer: Buffer, mimetype: string): boolean {
  const entry = MAGIC_NUMBERS.find((m) => m.mime === mimetype);
  if (!entry) return false;
  if (buffer.length < entry.bytes.length) return false;
  return entry.bytes.every((byte, i) => buffer[i] === byte);
}

function createImageUpload(subfolder: string) {
  const dir = path.join(uploadsRoot, subfolder);
  fs.mkdirSync(dir, { recursive: true });

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (_req, file, cb) => {
      // 副档名固定从白名单查表，跟上传者填的原始档名完全无关。
      const ext = ALLOWED_MIME_TYPES[file.mimetype] ?? ".jpg";
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    }
  });

  const upload = multer({
    storage,
    limits: { fileSize: HARD_CEILING_FILE_SIZE_BYTES },
    fileFilter: (_req, file, cb) => {
      if (!(file.mimetype in ALLOWED_MIME_TYPES)) {
        cb(new ValidationError("只允许上传 JPEG/PNG/WEBP 格式的图片"));
        return;
      }
      cb(null, true);
    }
  });

  return { upload, dir };
}

const { upload: collectionProofUploadRaw, dir: collectionProofDir } = createImageUpload("collections");

/**
 * multer 的 fileFilter 只能看 Content-Type header，看不到真正的档案内容——header 是上传者
 * 自己填的，完全可以造假。这个 middleware 包在 multer 后面，档案落盘之后再读开头几个字节
 * 跟对应格式的 magic number 比对，比对不上就把刚刚存的档案删掉、直接拒绝这次请求。
 */
export function collectionProofUpload() {
  return [
    collectionProofUploadRaw.single("file"),
    asyncHandler(async (req, res, next) => {
      if (!req.file) {
        next();
        return;
      }

      const filePath = path.join(collectionProofDir, req.file.filename);

      const settings = await getCompanySettings();
      const configuredMaxBytes = settings.maxUploadFileSizeMb * 1024 * 1024;
      if (req.file.size > configuredMaxBytes) {
        fs.unlinkSync(filePath);
        next(new ValidationError(`档案大小不能超过 ${settings.maxUploadFileSizeMb}MB`));
        return;
      }

      const handle = fs.openSync(filePath, "r");
      const header = Buffer.alloc(12);
      fs.readSync(handle, header, 0, 12, 0);
      fs.closeSync(handle);

      if (!matchesMagicNumber(header, req.file.mimetype)) {
        fs.unlinkSync(filePath);
        next(new ValidationError("档案内容跟宣告的图片格式不符"));
        return;
      }

      next();
    })
  ];
}

export function collectionProofImageUrl(filename: string) {
  return `/uploads/collections/${filename}`;
}
