import { readFileSync, writeFileSync } from 'fs';

const filesToUpdate = ['manifest.json', 'package.json'];

function bumpVersion() {
    // Les manifest.json
    let manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
    const oldVersion = manifest.version;

    // Øk patch-versjonen (1.0.0 → 1.0.1)
    const [major, minor, patch] = oldVersion.split('.').map(Number);
    const newVersion = `${major}.${minor}.${patch + 1}`;

    console.log(`🔄 Bumper versjon: ${oldVersion} → ${newVersion}`);

    // Oppdater manifest.json
    manifest.version = newVersion;
    writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');

    // Oppdater package.json hvis den finnes
    try {
        let pkg = JSON.parse(readFileSync('package.json', 'utf8'));
        pkg.version = newVersion;
        writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
    } catch (e) {
        console.log('⚠️  package.json ble ikke funnet');
    }

    // Oppdater versions.json
    let versions = {};
    try {
        versions = JSON.parse(readFileSync('versions.json', 'utf8'));
    } catch (e) {
        console.log('📄 Oppretter ny versions.json');
    }

    // Legg til ny versjon med minAppVersion fra manifest
    versions[newVersion] = manifest.minAppVersion || "1.13.0";
    
    writeFileSync('versions.json', JSON.stringify(versions, null, 2) + '\n');

    console.log(`✅ Ferdig! Versjon oppdatert til ${newVersion}`);
    console.log(`📌 versions.json oppdatert med "${newVersion}": "${manifest.minAppVersion}"`);
}

bumpVersion();