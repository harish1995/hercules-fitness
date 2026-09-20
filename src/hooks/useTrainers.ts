import { listTrainers } from '../services/trainerService';
import { type Trainer } from '../types/member';
import { useAsyncData, type AsyncData } from './useAsyncData';

export function useTrainers(): AsyncData<Trainer[]> {
  return useAsyncData(listTrainers, 'trainers');
}
