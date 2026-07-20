/**
 * ==========================================================
 * services/visionService.js
 * ANOR V14
 * Passerelle de décodage des sceaux via script Python externe
 * ==========================================================
 */

const { spawn } = require("child_process");

class VisionService {

    /**
     * Décode un buffer d'image de sceau en appelant le script Python de vision
     * @param {Buffer} imageBuffer - Buffer de l'image capturée par l'APK
     * @returns {Object} Résultat du décodage contenant le succès et la signature géométrique
     */
    static decoder(imageBuffer) {
        return new Promise((resolve) => {
            const pythonProcess = spawn("python", ["vision_decoder.py"]);

            let dataString = "";
            let errorString = "";

            pythonProcess.stdout.on("data", (data) => {
                dataString += data.toString();
            });

            pythonProcess.stderr.on("data", (data) => {
                errorString += data.toString();
            });

            pythonProcess.on("close", (code) => {
                if (code !== 0 || errorString) {
                    // Fallback de sécurité ou échec propre si python échoue
                    return resolve({
                        success: false,
                        message: "Erreur lors du traitement visuel par OpenCV",
                        error: errorString
                    });
                }

                try {
                    const result = JSON.parse(dataString);
                    resolve(result);
                } catch (e) {
                    resolve({
                        success: false,
                        message: "Réponse invalide du décodeur vision",
                        raw: dataString
                    });
                }
            });

            // Envoi du buffer image via l'entrée standard du processus Python
            pythonProcess.stdin.write(imageBuffer);
            pythonProcess.stdin.end();
        });
    }
}

module.exports = VisionService;