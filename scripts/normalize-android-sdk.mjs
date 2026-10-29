import { existsSync, readdirSync, renameSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdk) throw new Error('Set ANDROID_HOME to the installed Android SDK.');
const platform = join(sdk, 'platforms', 'android-36');
// Some SDK manager/archive combinations retain the platform archive's inner folder.
// This exact layout occurred during the candidate build. Never replace existing files.
if (!existsSync(join(platform, 'android.jar'))) {
  const inner = join(platform, 'android-36');
  if (!existsSync(join(inner, 'android.jar')) || !existsSync(join(inner, 'source.properties'))) {
    throw new Error('Android SDK platform 36 is incomplete. Install platforms;android-36.');
  }
  const names = readdirSync(inner);
  for (const name of names) {
    if (existsSync(join(platform, name))) throw new Error(`Android SDK layout collision: ${name}`);
  }
  for (const name of names) renameSync(join(inner, name), join(platform, name));
  rmdirSync(inner);
}
console.log('Android SDK platform 36 is ready.');
