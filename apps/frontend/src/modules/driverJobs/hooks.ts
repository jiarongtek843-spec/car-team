import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as driverJobsApi from "./api";

const MY_LEGS_KEY = ["driver-legs"];
const MY_OFFERS_KEY = ["driver-offers"];
// Offer 有明确的逾时时限（CompanySettings.dispatchOfferTimeoutSeconds，通常几十秒），
// 轮询要比 Dispatch Center 的 5 秒更紧一点，不然 Driver 可能看着一个其实已经过期/被
// 别人抢走的 Offer 卡片按下去才发现晚了。
const OFFERS_POLL_INTERVAL_MS = 3000;

export function useMyLegsQuery() {
  return useQuery({
    queryKey: MY_LEGS_KEY,
    queryFn: driverJobsApi.fetchMyLegs
  });
}

export function useMyOffersQuery() {
  return useQuery({
    queryKey: MY_OFFERS_KEY,
    queryFn: driverJobsApi.fetchMyOffers,
    refetchInterval: OFFERS_POLL_INTERVAL_MS
  });
}

export function useAcceptOfferMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (offerId: number) => driverJobsApi.acceptOffer(offerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MY_OFFERS_KEY });
      queryClient.invalidateQueries({ queryKey: MY_LEGS_KEY });
    }
  });
}

export function useDeclineOfferMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (offerId: number) => driverJobsApi.declineOffer(offerId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MY_OFFERS_KEY })
  });
}

export function useAcceptLegMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (legId: number) => driverJobsApi.acceptLeg(legId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MY_LEGS_KEY })
  });
}

export function useRejectLegMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ legId, reason }: { legId: number; reason: string }) => driverJobsApi.rejectLeg(legId, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MY_LEGS_KEY })
  });
}

export function useMarkArrivingMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (legId: number) => driverJobsApi.markArriving(legId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MY_LEGS_KEY })
  });
}

export function useMarkOnBoardMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (legId: number) => driverJobsApi.markOnBoard(legId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MY_LEGS_KEY })
  });
}

export function useCompleteLegMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (legId: number) => driverJobsApi.completeLeg(legId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MY_LEGS_KEY });
      // Complete Job 会在同一个 Transaction 里立刻记一笔 Wallet Transaction（LEG_EARNING
      // 或 REVENUE_SHARE_PAYOUT），但这里原本没有 invalidate ["wallet"]——Driver 首页的
      // 「今日收入」跟 My Earnings 页面都读同一份 wallet query cache，不 invalidate 的话
      // 金额已经在后端入帐了，画面却要等使用者手动重新整理才会显示，看起来像是「没有入帐」。
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
    }
  });
}
