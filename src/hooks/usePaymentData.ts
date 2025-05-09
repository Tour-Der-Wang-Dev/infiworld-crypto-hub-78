
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Transaction, PaymentType } from "@/components/payments/types";
import { formatTransactionData, requestRefund, canRequestRefund, canReleaseEscrow } from "@/utils/payment-utils";

interface UsePaymentDataProps {
  initialLimit?: number;
  filterType?: PaymentType;
  showEscrowOnly?: boolean;
}

/**
 * Custom hook to fetch and manage payment transaction data
 */
export const usePaymentData = ({ 
  initialLimit = 100,
  filterType,
  showEscrowOnly = false 
}: UsePaymentDataProps = {}) => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const { user } = useAuth();

  /**
   * Fetch transactions from Supabase with optional filtering
   */
  const fetchTransactions = useCallback(async () => {
    if (!user) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Build query with appropriate filters
      let query = supabase
        .from("payments")
        .select(`
          *,
          escrow_transactions(*)
        `)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      
      // Apply filter by payment type if specified
      if (filterType) {
        query = query.eq("related_type", filterType);
      }
      
      // Apply escrow filter if specified
      if (showEscrowOnly) {
        query = query.not("escrow_transactions", "is", null);
      }
      
      // Apply limit
      query = query.limit(initialLimit);
      
      const { data, error } = await query;
        
      if (error) throw error;
      
      // Process and set transaction data
      const formattedData = formatTransactionData(data || []);
      setTransactions(formattedData);
    } catch (error: any) {
      console.error("Error fetching transactions:", error);
      setError(error instanceof Error ? error : new Error("Failed to fetch transactions"));
      toast.error("ไม่สามารถดึงข้อมูลธุรกรรมได้", {
        description: "กรุณาลองใหม่อีกครั้ง"
      });
    } finally {
      setIsLoading(false);
    }
  }, [user, initialLimit, filterType, showEscrowOnly]);

  /**
   * Handle requesting a refund for a transaction
   */
  const handleRequestRefund = useCallback(async (transactionId: string) => {
    if (!user) return;
    
    try {
      toast.loading("กำลังดำเนินการขอคืนเงิน...");
      
      const { success, error } = await requestRefund(transactionId);
      
      if (!success) throw error;
      
      toast.dismiss();
      toast.success("ส่งคำขอคืนเงินเรียบร้อยแล้ว", {
        description: "เจ้าหน้าที่จะตรวจสอบคำขอและดำเนินการต่อไป"
      });
      
      // Refresh transactions list
      await fetchTransactions();
    } catch (error) {
      toast.dismiss();
      console.error("Error requesting refund:", error);
      toast.error("ไม่สามารถส่งคำขอคืนเงินได้", {
        description: "กรุณาลองใหม่อีกครั้ง"
      });
    }
  }, [user, fetchTransactions]);
  
  /**
   * Handle releasing escrow funds for a transaction
   */
  const handleReleaseEscrow = useCallback(async (transactionId: string) => {
    if (!user) return;
    
    try {
      toast.loading("กำลังดำเนินการปล่อยเงิน Escrow...");
      
      // Get the escrow transaction first
      const { data: paymentData, error: paymentError } = await supabase
        .from("payments")
        .select("escrow_transactions(*)")
        .eq("id", transactionId)
        .single();
      
      if (paymentError) throw paymentError;
      if (!paymentData?.escrow_transactions?.length) {
        throw new Error("ไม่พบข้อมูล Escrow สำหรับธุรกรรมนี้");
      }
      
      const escrowId = paymentData.escrow_transactions[0].id;
      
      // Update escrow status
      const { error: escrowError } = await supabase
        .from("escrow_transactions")
        .update({
          escrow_status: "released",
          release_date: new Date().toISOString()
        })
        .eq("id", escrowId);
        
      if (escrowError) throw escrowError;
      
      toast.dismiss();
      toast.success("ปล่อยเงิน Escrow เรียบร้อยแล้ว", {
        description: "เงินได้ถูกโอนให้ผู้ขายเรียบร้อยแล้ว"
      });
      
      // Refresh transactions list
      await fetchTransactions();
    } catch (error: any) {
      toast.dismiss();
      console.error("Error releasing escrow:", error);
      toast.error("ไม่สามารถปล่อยเงิน Escrow ได้", {
        description: error.message || "กรุณาลองใหม่อีกครั้ง"
      });
    }
  }, [user, fetchTransactions]);
  
  // Load transactions on first render
  useEffect(() => {
    if (user) {
      fetchTransactions();
    }
  }, [user, fetchTransactions]);

  return {
    transactions,
    isLoading,
    error,
    fetchTransactions,
    handleRequestRefund,
    handleReleaseEscrow,
    canRequestRefund,
    canReleaseEscrow: (transaction: Transaction) => canReleaseEscrow(transaction, user?.id),
    user
  };
};
