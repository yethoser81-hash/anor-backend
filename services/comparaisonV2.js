/**
 * ==========================================================
 * services/comparaisonV2.js
 * ANOR V14
 * Moteur de scoring géométrique et de tolérance aux variations
 * ==========================================================
 */

class ComparaisonV2 {

    /**
     * Compare la signature de lecture avec les candidats potentiels en mémoire
     * @param {Array} signatureLecture - Glyphes extraits du scan
     * @param {Array} candidats - Liste des produits candidats récupérés via l'index
     * @returns {Object} Résultat de la comparaison (score, diagnostic, produit)
     */
    comparer(signatureLecture, candidats) {
        if (!candidats || candidats.length === 0) {
            return {
                score: 0.0,
                diagnostic: "Aucun candidat correspondant dans l'index.",
                produit: null
            };
        }

        let meilleurScore = -1;
        let meilleurProduit = null;
        let meilleurDiagnostic = "Échec de correspondance géométrique";

        for (const candidat of candidats) {
            const resultatScore = this._calculerScoreDetaille(signatureLecture, candidat.bibliotheque_formes.glyphes);
            
            if (resultatScore.score > meilleurScore) {
                meilleurScore = resultatScore.score;
                meilleurProduit = candidat;
                meilleurDiagnostic = resultatScore.diagnostic;
            }
        }

        return {
            score: Number(meilleurScore.toFixed(4)),
            diagnostic: meilleurDiagnostic,
            produit: meilleurScore >= 0.85 ? meilleurProduit : null
        };
    }

    /**
     * Calcule un score de correspondance détaillé entre deux ensembles de glyphes
     */
    _calculerScoreDetaille(glyphesLecture, glyphesReference) {
        if (!glyphesLecture || !glyphesReference || glyphesReference.length === 0) {
            return { score: 0.0, diagnostic: "Données de glyphes invalides" };
        }

        let correspondances = 0;
        const toleranceAngle = 5.0; // tolérance en degrés
        const toleranceRayon = 3.0; // tolérance en pixels

        for (const gL of glyphesLecture) {
            const trouve = glyphesReference.some(gR => {
                const memeForme = gL.forme === gR.forme;
                const memeAnneau = gL.anneau === gR.anneau;
                const procheAngle = Math.abs(gL.angle - gR.angle) <= toleranceAngle;
                const procheRayon = Math.abs(gL.rayon - gR.rayon) <= toleranceRayon;
                return memeForme && memeAnneau && procheAngle && procheRayon;
            });

            if (trouve) {
                correspondances++;
            }
        }

        const score = correspondances / Math.max(glyphesLecture.length, glyphesReference.length);
        
        return {
            score: score,
            diagnostic: score >= 0.85 ? "Correspondance validée avec succès" : "Score sous le seuil d'exigence (0.85)"
        };
    }
}

module.exports = ComparaisonV2;