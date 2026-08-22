export type FoodActionIntent = 'satisfyNeed' | 'deliberateExperiment';
export type FoodIngestionMotivation = 'need' | 'deliberateExperiment';

export function motivationForFoodIntent(intent: FoodActionIntent): FoodIngestionMotivation {
  return intent === 'deliberateExperiment' ? 'deliberateExperiment' : 'need';
}
