import crypto from "crypto";

class Encrypter {
  algorithm: string;
  key: any;

  constructor() {
    this.algorithm = "aes-192-cbc";
  }

  setKey(encryptionKey: string, encryptionSalt: string) {
    if (encryptionKey.length > 5 && encryptionSalt.length >= 4) {
      this.key = crypto.scryptSync(encryptionKey, encryptionSalt, 24);
    } else {
      throw "EncryptionKey lenght is less than 5";
    }
  }

  isKeySet() {
    return this.key != undefined;
  }

  encrypt(clearText: string) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    const encrypted = cipher.update(clearText, "utf8", "hex");
    return [encrypted + cipher.final("hex"), Buffer.from(iv).toString("hex")].join("|");
  }

  isKeyEncrypted(encryptedText: string) {
    const [encrypted, iv] = encryptedText.split("|");
    return iv;
  }

  dencrypt(encryptedText: string) {
    const [encrypted, iv] = encryptedText.split("|");
    if (!iv) throw new Error("IV not found");
    const decipher = crypto.createDecipheriv(this.algorithm, this.key, Buffer.from(iv, "hex"));
    return decipher.update(encrypted, "hex", "utf8") + decipher.final("utf8");
  }
}

export default new Encrypter();
