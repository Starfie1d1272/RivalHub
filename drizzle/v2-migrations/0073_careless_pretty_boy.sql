-- rivalhub:migration-risk: contract-cleanup Issue 806: owner confirms scenario simulation never opened; remove unused persistence directly without staged compatibility.
DROP TABLE "prediction_scenarios";
