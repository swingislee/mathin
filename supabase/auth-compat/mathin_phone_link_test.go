package api

// 固定开发身份的事务回归；每条路径均返回普通 rollback 哨兵，不提交 Auth 的 CommitWithError。
import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"

	"github.com/gofrs/uuid"
	"github.com/supabase/auth/internal/api/provider"
	"github.com/supabase/auth/internal/conf"
	"github.com/supabase/auth/internal/mailer/mockclient"
	"github.com/supabase/auth/internal/models"
	"github.com/supabase/auth/internal/storage"
)

func TestMathinPhoneOnlyIdentityLinkRollback(t *testing.T) {
	if os.Getenv("MATHIN_LOCAL_AUTH_TX") != "1" {
		t.Fatal("local attestation required")
	}
	config, err := conf.LoadGlobalFromEnv()
	if err != nil {
		t.Fatal("configuration unavailable")
	}
	target, err := url.Parse(config.DB.URL)
	if err != nil || (target.Hostname() != "db" && target.Hostname() != "supabase-db") || target.Path != "/postgres" {
		t.Fatal("local database required")
	}
	db, err := storage.Dial(config)
	if err != nil {
		t.Fatal("database unavailable")
	}
	defer db.Close()
	userID, err := uuid.FromString(os.Getenv("MATHIN_LOCAL_FIXED_USER_ID"))
	if err != nil {
		t.Fatal("fixed manifest identity required")
	}
	config.Mailer.Autoconfirm = false
	config.Mailer.Notifications.IdentityLinkedEnabled = false
	config.Mailer.Notifications.IdentityUnlinkedEnabled = false
	api := NewAPI(config, db, WithMailer(&mockclient.MockMailer{}))
	rollback := errors.New("mathin rollback")
	for _, test := range []struct {
		name, email                      string
		verified, expectError, keepEmail bool
	}{
		{"phone_without_email", "", false, false, false},
		{"phone_without_email_verified_claim", "", true, false, false},
		{"provider_verified_email", "synthetic@example.invalid", true, false, false},
		{"provider_unverified_email", "synthetic@example.invalid", false, true, false},
		{"existing_email_account", "", false, false, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			var checkErr error
			err := db.Transaction(func(tx *storage.Connection) error {
				checkErr = func() error {
					if err := tx.RawQuery("set local lock_timeout='3s'; set local statement_timeout='20s'").Exec(); err != nil {
						return errors.New("transaction setup failed")
					}
					user, err := models.FindUserByID(tx, userID)
					if err != nil || user.IsAnonymous || user.EncryptedPassword == nil {
						return errors.New("fixed password account required")
					}
					passwordHash := *user.EncryptedPassword
					originalEmail := user.GetEmail()
					// 仅在此回滚事务中，把同一个固定 UUID 模拟为纯手机号账号。
					if !test.keepEmail {
						if err := tx.RawQuery("delete from auth.identities where user_id = ?", userID).Exec(); err != nil {
							return errors.New("fixture identity setup failed")
						}
						if err := tx.RawQuery("update auth.users set email=null,email_confirmed_at=null,phone='13800000000',phone_confirmed_at=now() where id=?", userID).Exec(); err != nil {
							return errors.New("fixture phone setup failed")
						}
						user, err = models.FindUserByID(tx, userID)
						if err != nil {
							return errors.New("fixture reload failed")
						}
						if test.email == "" {
							phoneIdentity, err := models.NewIdentity(user, "phone", map[string]interface{}{"sub": userID.String(), "phone": user.GetPhone()})
							if err != nil || tx.Create(phoneIdentity) != nil {
								return errors.New("fixture phone identity failed")
							}
						}
					}
					data := &provider.UserProvidedData{Metadata: &provider.Claims{Subject: "mathin-transaction-only", Email: test.email, EmailVerified: test.verified}}
					request := httptest.NewRequest(http.MethodGet, "/identities", nil)
					linked, linkErr := api.linkIdentityToUser(request, withTargetUser(context.Background(), user), tx, data, "custom:wechat")
					if test.expectError {
						var confirmation *storage.CommitWithError
						if !errors.As(linkErr, &confirmation) {
							return errors.New("unverified provider email lost its confirmation requirement")
						}
						return nil
					}
					if linkErr != nil || linked == nil {
						return errors.New("native identity linking failed")
					}
					if linked.ID != userID || linked.GetPhone() != user.GetPhone() || linked.EncryptedPassword == nil || *linked.EncryptedPassword != passwordHash {
						return errors.New("existing account changed")
					}
					if test.keepEmail && linked.GetEmail() != originalEmail {
						return errors.New("existing email changed")
					}
					if test.email == "" && !test.keepEmail && (linked.GetEmail() != "" || linked.EmailConfirmedAt != nil) {
						return errors.New("no-email account acquired an email confirmation")
					}
					if test.email != "" && (linked.GetEmail() != test.email || linked.EmailConfirmedAt == nil) {
						return errors.New("verified email semantics changed")
					}
					identity, err := models.FindIdentityByIdAndProvider(tx, data.Metadata.Subject, "custom:wechat")
					if err != nil || identity.UserID != userID {
						return errors.New("identity points to another account")
					}
					if _, err := api.linkIdentityToUser(request, withTargetUser(context.Background(), linked), tx, data, "custom:wechat"); err == nil {
						return errors.New("duplicate identity accepted")
					}
					return nil
				}()
				return rollback
			})
			if !errors.Is(err, rollback) {
				t.Fatal("transaction rollback failed")
			}
			if checkErr != nil {
				t.Fatal(checkErr)
			}
		})
	}
}
