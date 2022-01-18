const fs = require("fs");
const path = require("path");

const distJsFolder = "dist-js";
const configSourceDir = path.join(__dirname, "./config");
const configDestDir = path.join(__dirname, `./${distJsFolder}/config`);
const envDestDir = path.join(__dirname, `./${distJsFolder}`);
const artifactsDir = path.join(__dirname, `./${distJsFolder}/artifacts`);

function copyDirectory(source, destination) {
  console.log(`copying directory ${source} to ${destination}`);
  fs.mkdirSync(destination, { recursive: true });

  fs.readdirSync(source, { withFileTypes: true }).forEach((entry) => {
    let sourcePath = path.join(source, entry.name);
    let destinationPath = path.join(destination, entry.name);

    entry.isDirectory() ? copyDirectory(sourcePath, destinationPath) : fs.copyFileSync(sourcePath, destinationPath);
  });
}

copyDirectory(path.join(__dirname, "./artifacts"), artifactsDir);
copyDirectory(configSourceDir, configDestDir);

const folders = [
  {
    path: __dirname,
    regex: /^\.env\..*$/,
    outputFile: envDestDir
  },
  {
    path: __dirname,
    regex: /^\package.*\..*$/,
    outputFile: envDestDir
  },
  {
    path: __dirname,
    regex: /^\LICENSE.*\..*$/,
    outputFile: envDestDir
  }
];

if (!fs.existsSync(configDestDir)) {
  fs.mkdirSync(configDestDir, { recursive: true });
}

folders.forEach((folder) => {
  fs.readdirSync(folder.path).forEach((file) => {
    if (folder.regex.test(file)) {
      console.log(`copying file ${file} to ${distJsFolder}`);
      fs.copyFileSync(`${folder.path}\\${file}`, `${folder.outputFile}\\${file}`);
    }
  });
});
