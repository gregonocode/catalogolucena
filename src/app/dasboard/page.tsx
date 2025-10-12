"use client";

import React from "react";
import {
  Gauge,
  Package2,
  Tags,
  ReceiptText,
  Users,
  TrendingUp,
  Clock,
  ShoppingCart,
} from "lucide-react";

const ACCENT = "#01A920";

export default function DashboardHomePage() {
  // Mocks de contadores (apenas visual por enquanto)
  const kpis = [
    { label: "Produtos", value: 18, icon: <Package2 className="w-5 h-5" /> },
    { label: "Categorias", value: 6, icon: <Tags className="w-5 h-5" /> },
    { label: "Pedidos", value: 42, icon: <ReceiptText className="w-5 h-5" /> },
    { label: "Clientes", value: 28, icon: <Users className="w-5 h-5" /> },
  ];

  const recentQuotes = [
    { id: "q-101", customer: "Ana Lima", total: 199.9, time: "há 2h" },
    { id: "q-102", customer: "Carla Silva", total: 129.9, time: "há 5h" },
    { id: "q-103", customer: "Paula Medeiros", total: 299.5, time: "ontem" },
  ];

  const topProducts = [
    { id: "p-1", title: "Blusa Femninina", qty: 32 },
    { id: "p-2", title: "Calça Jeans ", qty: 21 },
    { id: "p-3", title: "Vestido Lucena", qty: 17 },
  ];

  function brl(n: number) {
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  return (
    <div className="max-w-screen-lg mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <span className="grid place-items-center w-9 h-9 rounded-xl" style={{ backgroundColor: ACCENT }}>
          <Gauge className="w-5 h-5 text-white" />
        </span>
        <h1 className="text-lg font-semibold">Visão geral</h1>
      </div>

      {/* KPIs */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-2xl border border-gray-100 bg-white shadow-sm p-3">
            <div className="flex items-center justify-between">
              <div className="text-xs text-gray-500">{k.label}</div>
              <span className="grid place-items-center w-7 h-7 rounded-lg bg-gray-50 border border-gray-100 text-gray-700">
                {k.icon}
              </span>
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight">{k.value}</div>
          </div>
        ))}
      </section>

      {/* Grafico placeholder */}
      <section className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="grid place-items-center w-7 h-7 rounded-lg" style={{ backgroundColor: ACCENT }}>
                <TrendingUp className="w-4 h-4 text-white" />
              </span>
              <h2 className="text-sm font-medium">Vendas (demo)</h2>
            </div>
            <span className="text-xs text-gray-500">últimos 7 dias</span>
          </div>
          <div className="h-36 rounded-xl bg-gray-50 border border-dashed border-gray-200 grid place-items-center text-xs text-gray-500">
            gráfico/linha do tempo (em breve)
          </div>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="grid place-items-center w-7 h-7 rounded-lg bg-gray-100 border border-gray-200">
                <ShoppingCart className="w-4 h-4 text-gray-700" />
              </span>
              <h2 className="text-sm font-medium">Produtos mais vistos (demo)</h2>
            </div>
            <span className="text-xs text-gray-500">período teste</span>
          </div>
          <ul className="space-y-2">
            {topProducts.map((p) => (
              <li key={p.id} className="flex items-center justify-between text-sm">
                <span className="truncate">{p.title}</span>
                <span className="text-gray-500">{p.qty} views</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Recentes */}
      <section className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="grid place-items-center w-7 h-7 rounded-lg bg-gray-100 border border-gray-200">
                <ReceiptText className="w-4 h-4 text-gray-700" />
              </span>
              <h2 className="text-sm font-medium">Pedidos recentes</h2>
            </div>
            <span className="text-xs text-gray-500 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> tempo real (em breve)
            </span>
          </div>
          <ul className="divide-y divide-gray-100">
            {recentQuotes.map((q) => (
              <li key={q.id} className="flex items-center justify-between py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-medium truncate">{q.customer}</div>
                  <div className="text-xs text-gray-500">{q.time}</div>
                </div>
                <div className="text-gray-900 font-semibold">{brl(q.total)}</div>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="grid place-items-center w-7 h-7 rounded-lg bg-gray-100 border border-gray-200">
                <Users className="w-4 h-4 text-gray-700" />
              </span>
              <h2 className="text-sm font-medium">Próximas melhorias</h2>
            </div>
          </div>
          <ul className="list-disc ml-5 text-sm text-gray-700 space-y-1">
            <li>Conectar KPIs ao Supabase (views/queries).</li>
            <li>Gráfico real com dados de orçamentos por dia.</li>
            <li>Card de conversão WhatsApp (cliques ➜ orçamentos).</li>
            <li>Widget de estoque por SKU.</li>
          </ul>
        </div>
      </section>

      {/* Aviso MVP */}
      <div className="text-center mt-6 p-3 rounded-2xl border border-gray-100 bg-gray-50 text-sm text-gray-700">
        Continuação em breve — Essa tela  demostrativa do uma dash do MVP
      </div>
    </div>
  );
}
