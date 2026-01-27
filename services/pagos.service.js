// backend/services/pagos.service.js

import axiosClient from "./axiosClient";

export const obtenerSeccionesPorCurso = (cursoId) =>
  axiosClient.get(`/secciones/curso/${cursoId}`);

export const iniciarPagoMercadoPago = (cursoId, titulo, precio) =>
  axiosClient.post("/pagos/mercadopago", { cursoId, titulo, precio });

export const generarYapeIzipay = (seccionId, form, curso) =>
  axiosClient.post("/pagos/yape/iniciar", { seccionId, form, curso });
