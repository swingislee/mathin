package api

// 真正的 Auth HTTP handler，连接固定身份的单个回滚事务，供仓库 Supabase SDK 调用。
// 不启动 Auth 后台任务、不运行上游清库初始化器；每个场景另设 savepoint。
import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gobuffalo/pop/v6/slices"
	"github.com/gofrs/uuid"
	"github.com/supabase/auth/internal/conf"
	"github.com/supabase/auth/internal/mailer/mockclient"
	"github.com/supabase/auth/internal/models"
	"github.com/supabase/auth/internal/storage"
)

func TestMathinWechatSDKRollback(t *testing.T) {
	if os.Getenv("MATHIN_LOCAL_AUTH_TX") != "1" || len(os.Getenv("MATHIN_FIXTURE_KEY")) < 32 {
		t.Fatal("local fixture required")
	}
	config, err := conf.LoadGlobalFromEnv()
	if err != nil {
		t.Fatal("configuration unavailable")
	}
	target, err := url.Parse(config.DB.URL)
	if err != nil || (target.Hostname() != "db" && target.Hostname() != "supabase-db") || target.Path != "/postgres" {
		t.Fatal("isolated database required")
	}
	db, err := storage.Dial(config)
	if err != nil {
		t.Fatal("database unavailable")
	}
	defer db.Close()
	owner, err := uuid.FromString(os.Getenv("MATHIN_LOCAL_FIXED_USER_ID"))
	if err != nil {
		t.Fatal("fixed identity required")
	}
	config.Mailer.Notifications.IdentityLinkedEnabled = false
	config.Mailer.Notifications.IdentityUnlinkedEnabled = false
	rollback := errors.New("mathin sdk rollback")
	err = db.Transaction(func(tx *storage.Connection) error {
		if err := tx.RawQuery("set local lock_timeout='3s'; set local statement_timeout='20s'; set local idle_in_transaction_session_timeout='180s'").Exec(); err != nil {
			return errors.New("transaction setup failed")
		}
		user, err := models.FindUserByID(tx, owner)
		if err != nil || user.EncryptedPassword == nil || user.IsAnonymous {
			return errors.New("fixed password identity required")
		}
		authorizeURL, tokenURL, userinfoURL := "https://127.0.0.1:9091/mock/authorize", "https://127.0.0.1:9091/mock/token", "https://127.0.0.1:9091/mock/userinfo"
		provider := &models.CustomOAuthProvider{
			ID: uuid.Must(uuid.NewV4()), ProviderType: models.ProviderTypeOAuth2, Identifier: "custom:wechat", Name: "Mathin transaction fixture",
			ClientID: "mathin-wechat", ClientSecret: os.Getenv("MATHIN_FIXTURE_KEY"), Scopes: slices.String{}, PKCEEnabled: true, EmailOptional: true, Enabled: true,
			AttributeMapping: slices.Map{}, AuthorizationParams: slices.Map{}, AcceptableClientIDs: slices.String{},
			AuthorizationURL: &authorizeURL, TokenURL: &tokenURL, UserinfoURL: &userinfoURL,
		}
		if err := tx.Create(provider); err != nil {
			t.Logf("fixture provider diagnostic: %v", err)
			return errors.New("fixture provider setup failed")
		}
		api := NewAPI(config, tx, WithMailer(&mockclient.MockMailer{}))
		mux := http.NewServeMux()
		mux.Handle("/auth/v1/", http.StripPrefix("/auth/v1", api))
		done := make(chan struct{})
		var finish sync.Once
		var mu sync.Mutex
		activeCase := false
		subject := "mathin:sdk-transaction-only"
		type grant struct{ challenge, subject string }
		grants, accesses := map[string]grant{}, map[string]string{}
		respond := func(w http.ResponseWriter, value interface{}) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(value)
		}
		mux.HandleFunc("/fixture/", func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("X-Mathin-Fixture") != os.Getenv("MATHIN_FIXTURE_KEY") {
				http.Error(w, "fixture authorization required", 403)
				return
			}
			mu.Lock()
			defer mu.Unlock()
			switch r.URL.Path {
			case "/fixture/ready":
				respond(w, map[string]bool{"ready": true})
			case "/fixture/start":
				if activeCase {
					http.Error(w, "case already active", 409)
					return
				}
				if err := tx.RawQuery("savepoint mathin_sdk_case").Exec(); err != nil {
					http.Error(w, "savepoint failed", 500)
					return
				}
				activeCase = true
				subject = "mathin:sdk-transaction-only"
				if r.URL.Query().Get("kind") == "phone" {
					if err := tx.RawQuery("delete from auth.identities where user_id=?", owner).Exec(); err != nil {
						http.Error(w, "phone identity setup failed", 500)
						return
					}
					if err := tx.RawQuery("update auth.users set email=null,email_confirmed_at=null,phone='8613800000000',phone_confirmed_at=now() where id=?", owner).Exec(); err != nil {
						http.Error(w, "phone user setup failed", 500)
						return
					}
					phoneUser, err := models.FindUserByID(tx, owner)
					if err != nil {
						http.Error(w, "phone fixture missing", 500)
						return
					}
					identity, err := models.NewIdentity(phoneUser, "phone", map[string]interface{}{"sub": owner.String(), "phone": phoneUser.GetPhone()})
					if err != nil || tx.Create(identity) != nil {
						http.Error(w, "phone identity failed", 500)
						return
					}
				}
				respond(w, map[string]bool{"started": true})
			case "/fixture/end":
				if !activeCase {
					http.Error(w, "case required", 409)
					return
				}
				if err := tx.RawQuery("rollback to savepoint mathin_sdk_case; release savepoint mathin_sdk_case").Exec(); err != nil {
					http.Error(w, "case rollback failed", 500)
					return
				}
				activeCase = false
				grants, accesses = map[string]grant{}, map[string]string{}
				respond(w, map[string]bool{"rolledBack": true})
			case "/fixture/unknown":
				subject = "mathin:unknown-sdk-identity"
				respond(w, map[string]bool{"unknown": true})
			case "/fixture/ban", "/fixture/unban":
				var until interface{}
				if r.URL.Path == "/fixture/ban" {
					until = time.Now().Add(time.Hour)
				}
				if err := tx.RawQuery("update auth.users set banned_until=? where id=?", until, owner).Exec(); err != nil {
					http.Error(w, "ban fixture failed", 500)
					return
				}
				respond(w, map[string]bool{"updated": true})
			case "/fixture/state":
				var state struct {
					Users      int `db:"users" json:"users"`
					Identities int `db:"identities" json:"identities"`
				}
				if err := tx.RawQuery("select (select count(*) from auth.users) users,(select count(*) from auth.identities where provider='custom:wechat') identities").First(&state); err != nil {
					http.Error(w, "state unavailable", 500)
					return
				}
				respond(w, state)
			case "/fixture/finish":
				respond(w, map[string]bool{"finishing": true})
				finish.Do(func() { close(done) })
			default:
				http.NotFound(w, r)
			}
		})
		mux.HandleFunc("/mock/authorize", func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			defer mu.Unlock()
			q := r.URL.Query()
			if q.Get("client_id") != "mathin-wechat" || q.Get("response_type") != "code" || q.Get("code_challenge_method") != "S256" || len(q.Get("code_challenge")) != 43 || q.Get("mathin_flow") == "" {
				http.Error(w, "OAuth request contract failed", 400)
				return
			}
			if q.Get("redirect_uri") != "https://127.0.0.1:9091/auth/v1/callback" {
				http.Error(w, "callback mismatch", 400)
				return
			}
			code := uuid.Must(uuid.NewV4()).String()
			grants[code] = grant{q.Get("code_challenge"), subject}
			callback, _ := url.Parse(q.Get("redirect_uri"))
			callback.RawQuery = url.Values{"code": {code}, "state": {q.Get("state")}}.Encode()
			http.Redirect(w, r, callback.String(), 303)
		})
		mux.HandleFunc("/mock/token", func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			defer mu.Unlock()
			_ = r.ParseForm()
			client, secret, ok := r.BasicAuth()
			if !ok {
				client, secret = r.Form.Get("client_id"), r.Form.Get("client_secret")
			}
			code := r.Form.Get("code")
			g, found := grants[code]
			delete(grants, code)
			hash := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
			if !found || client != "mathin-wechat" || secret != os.Getenv("MATHIN_FIXTURE_KEY") || r.Form.Get("grant_type") != "authorization_code" || r.Form.Get("redirect_uri") != "https://127.0.0.1:9091/auth/v1/callback" || base64.RawURLEncoding.EncodeToString(hash[:]) != g.challenge {
				http.Error(w, "token contract failed", 400)
				return
			}
			access := uuid.Must(uuid.NewV4()).String()
			accesses[access] = g.subject
			respond(w, map[string]interface{}{"access_token": access, "token_type": "Bearer", "expires_in": 60})
		})
		mux.HandleFunc("/mock/userinfo", func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			defer mu.Unlock()
			token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			claim, ok := accesses[token]
			delete(accesses, token)
			if !ok {
				http.Error(w, "single-use token required", 401)
				return
			}
			respond(w, map[string]string{"sub": claim, "name": "Synthetic WeChat"})
		})
		listener, err := net.Listen("tcp", "0.0.0.0:9091")
		if err != nil {
			return errors.New("fixture listener unavailable")
		}
		server := httptest.NewUnstartedServer(mux)
		_ = server.Listener.Close()
		server.Listener = listener
		server.Config.ReadHeaderTimeout = 5 * time.Second
		server.StartTLS()
		defer server.Close()
		// 仅此 fixture 信任 httptest 的证书，应用与正式 Auth 的 TLS 验证保持原样。
		originalTransport := http.DefaultTransport
		http.DefaultTransport = server.Client().Transport
		defer func() { http.DefaultTransport = originalTransport }()
		select {
		case <-done:
		case <-time.After(150 * time.Second):
			t.Error("SDK fixture timed out")
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Config.Shutdown(ctx)
		return rollback
	})
	if !errors.Is(err, rollback) {
		t.Fatalf("native HTTP transaction did not roll back: %v", err)
	}
}
