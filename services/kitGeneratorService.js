/**
 * ==========================================================
 * services/kitGeneratorService.js
 * ANOR V14
 * Service backend de création du kit d'impression et de sérialisation
 * ==========================================================
 */

class KitGeneratorService {

    /**
     * Génère les métadonnées et instructions du kit d'impression pour un lot de production
     * @param {Object} donneesLot - Informations du produit et de la quantité
     * @returns {Object} Kit complet avec sérialisation
     */
    static genererKit(donneesLot) {
        const { nom_produit, nom_producteur, lot, pays_origine, quantite } = donneesLot;
        const qte = parseInt(quantite || 1, 10);

        const elementsSerie = [];

        for (let i = 1; i <= qte; i++) {
            elementsSerie.push({
                numeroSerie: i,
                totalSerie: qte,
                referenceEtiquette: `${lot}-SERIE-${i.toString().padStart(4, '0')}`
            });
        }

        return {
            produit: nom_produit,
            producteur: nom_producteur,
            lot: lot,
            pays: pays_origine,
            quantiteTotale: qte,
            guideUtilisation: "Apposer le sceau numéroté sur chaque étiquette produit conformément au repère angulaire statique.",
            tailleMinimaleRequise: "50mm x 50mm",
            guideJuridique: "Certification officielle ANOR V14 - Toute reproduction non autorisée est passible de poursuites.",
            elementsSerie: elementsSerie
        };
    }
}

module.exports = KitGeneratorService;