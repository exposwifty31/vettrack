import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Bdi } from "@/components/ui/bdi";
import { TruncatedText } from "@/components/ui/truncated-text";
import { Clock, XCircle, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useConfirm } from "@/hooks/use-confirm";
import { t, formatDateByLocale } from "@/lib/i18n";
import { haptics } from "@/lib/haptics";

export function PendingUsersSection() {
  const confirm = useConfirm();
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  const { data: pendingUsers, isLoading } = useQuery({
    queryKey: ["/api/users/pending"],
    queryFn: api.users.listPending,
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const updateStatusMut = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: "active" | "blocked";
    }) => api.users.updateStatus(id, status),
    onSuccess: (_, { status }) => {
      haptics.tap();
      queryClient.invalidateQueries({ queryKey: ["/api/users/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast.success(status === "active" ? t.adminPage.userApproved : t.adminPage.userRejected);
    },
    onError: () => toast.error(t.adminPage.userStatusUpdateFailed),
  });

  return (
    <Card className="bg-card border-border/60 shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Clock className="w-4 h-4 text-muted-foreground" />
          {t.adminPage.pendingUsersTitle}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex flex-col gap-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : !pendingUsers || pendingUsers.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            {t.adminPage.pendingEmpty}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {pendingUsers.map((user) => (
              <div
                key={user.id}
                data-testid={`pending-user-row-${user.id}`}
                className="flex items-center justify-between p-3 bg-background rounded-xl border border-border gap-3 hover:bg-muted/50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <Bdi>
                    <TruncatedText
                      text={user.displayName || user.name || user.email}
                      className="text-sm font-medium"
                      as="p"
                    />
                  </Bdi>
                  <Bdi dir="ltr">
                    <TruncatedText text={user.email} className="text-xs text-muted-foreground" as="p" />
                  </Bdi>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t.adminPage.signedUp(formatDateByLocale(user.createdAt))}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive h-11 px-2.5"
                    disabled={updateStatusMut.isPending}
                    data-testid={`btn-reject-user-${user.id}`}
                    onClick={async () => {
                      if (
                        !(await confirm({
                          title: t.adminPage.rejectUserTitle(user.displayName || user.name || user.email || ""),
                          description: t.adminPage.rejectUserBody,
                          confirmLabel: t.adminPage.rejectUserConfirm,
                          destructive: true,
                        }))
                      ) {
                        return;
                      }
                      updateStatusMut.mutate({ id: user.id, status: "blocked" });
                    }}
                  >
                    <XCircle className="w-3.5 h-3.5 me-1" />
                    {t.adminPage.reject}
                  </Button>
                  <Button
                    size="sm"
                    className="bg-[var(--status-ok-fg)] hover:opacity-90 text-white h-11 px-2.5"
                    onClick={() =>
                      updateStatusMut.mutate({ id: user.id, status: "active" })
                    }
                    disabled={updateStatusMut.isPending}
                    data-testid={`btn-approve-user-${user.id}`}
                  >
                    <CheckCircle className="w-3.5 h-3.5 me-1" />
                    {t.adminPage.approve}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
