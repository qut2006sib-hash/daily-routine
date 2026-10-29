import { Capacitor } from "@capacitor/core";

export async function saveBackupFile(contents: string): Promise<"shared" | "downloaded"> {
  const name = `dayline-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
      import("@capacitor/filesystem"), import("@capacitor/share"),
    ]);
    const file = await Filesystem.writeFile({ path: `backups/${name}`, data: contents,
      directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true });
    await Share.share({ title: "Dayline backup", dialogTitle: "Save or share your backup", files: [file.uri] });
    return "shared";
  }
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  return "downloaded";
}
