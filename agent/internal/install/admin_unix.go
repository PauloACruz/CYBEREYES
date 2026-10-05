//go:build !windows

package install

import (
	"os"

	"github.com/pauloacruz/cybereyes/agent/internal/config"
)

func isAdmin() bool { return os.Geteuid() == 0 }

func removeInstallDir() { _ = os.RemoveAll(config.InstallDir()) }
