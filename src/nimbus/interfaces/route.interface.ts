export interface ShapedStop {
  id: number;
  name: string;
  latitude?: number;
  longitude?: number;
}

export interface ShapedRoute {
  id: number;
  name: string;
  from: string;
  to: string;
  depotId: number;
  stops: ShapedStop[];
  totalStops: number;
  unitId?: string | null;
  unitName?: string | null;
}

export interface RoutesResponse {
  success: boolean;
  routes: ShapedRoute[];
  totalRoutes: number;
}

// Interfaces para ruta individual con coordenadas completas
export interface DetailedStop {
  id: number;
  name: string;
  lat: number; // ✅ Propiedad explícita para Google Maps
  lng: number; // ✅ Propiedad explícita para Google Maps
  order: number;
}

export interface DetailedRoute {
  id: number;
  name: string;
  from: string;
  to: string;
  depotId: number;
  stops: DetailedStop[];
  totalStops: number;
  encodedPath?: string; // ✅ Polilínea codificada para Google Maps
  distance?: number; // Distancia total en metros
  duration?: number; // Duración estimada en segundos
  unitId?: string | null;
  unitName?: string | null;
}

export interface RouteDetailResponse {
  success: boolean;
  route: DetailedRoute;
}
