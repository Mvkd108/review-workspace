import { createContext, useContext } from 'react';
import { api, type ApiLike } from '../api';

export const ApiContext = createContext<ApiLike>(api);

export function useApi(): ApiLike {
  return useContext(ApiContext);
}
