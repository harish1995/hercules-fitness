import { listPlans } from '../services/planService';
import { type Plan } from '../types/membership';
import { useAsyncData, type AsyncData } from './useAsyncData';

export function usePlans(): AsyncData<Plan[]> {
  return useAsyncData(listPlans, 'plans');
}
