import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicAssets = resolve(projectRoot, "public", "assets");
const musicCoverOutput = resolve(
	projectRoot,
	"src",
	"assets",
	"music",
	"cover",
);

// Banners are handled by scripts/sync-banners.js (TinaCMS-managed).

await mkdir(musicCoverOutput, { recursive: true });
for (const name of ["cl", "dazbee", "hitori", "xryx"]) {
	const source = resolve(publicAssets, "music", "cover", `${name}.webp`);
	const target = resolve(musicCoverOutput, `${name}.webp`);
	const metadata = await sharp(source).metadata();

	if ((metadata.width ?? 0) <= 192 && (metadata.height ?? 0) <= 192) {
		await cp(source, target);
	} else {
		await sharp(source)
			.resize(192, 192, { fit: "cover", position: "centre" })
			.webp({ quality: 85 })
			.toFile(target);
	}
}

console.log("Prepared player-sized music covers.");
