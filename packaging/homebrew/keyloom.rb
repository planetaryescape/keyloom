# The cask for planetaryescape/homebrew-tap (Casks/keyloom.rb). Prepared here; update-cask.sh fills version and sha256 from a release.
cask "keyloom" do
  version "0.36.1"
  sha256 "REPLACE_WITH_THE_RELEASE_SHA256"

  url "https://github.com/planetaryescape/keyloom/releases/download/v#{version}/keyloom-#{version}-darwin-arm64.app.zip"
  name "keyloom"
  desc "Local-first keyboard configurator for QMK and ZMK boards"
  homepage "https://github.com/planetaryescape/keyloom"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on arch: :arm64
  depends_on macos: ">= :monterey"

  app "keyloom.app"
  # One install, one version: the bundled binary is the CLI too (install.sh stays for the CLI alone, and for Linux).
  binary "#{appdir}/keyloom.app/Contents/MacOS/keyloom"

  zap trash: "~/Library/Application Support/dev.planetaryescape.keyloom"
end
