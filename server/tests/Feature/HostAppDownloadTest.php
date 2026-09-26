<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\HostAppRelease;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

/** Admin → Host PCs offers the newest Windows installer, a host-app-v* GitHub Release. */
class HostAppDownloadTest extends TestCase
{
    use RefreshDatabase;

    private const API = 'https://api.github.com/repos/thabang-teddy/Block-survival/releases*';

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.host_app.repo' => 'thabang-teddy/Block-survival', 'services.host_app.github_token' => null]);
        Cache::flush();
    }

    /** @return array<string, mixed> */
    private function release(string $tag, array $assets, array $extra = []): array
    {
        return [
            'tag_name' => $tag, 'draft' => false, 'prerelease' => false,
            'published_at' => '2026-09-27T10:00:00Z', 'html_url' => "https://github.com/thabang-teddy/Block-survival/releases/tag/{$tag}",
            'assets' => $assets, ...$extra,
        ];
    }

    private function msi(string $version): array
    {
        return [
            'name' => "BlockSurvivalHost-{$version}.msi", 'size' => 100_000_000,
            'browser_download_url' => "https://github.com/thabang-teddy/Block-survival/releases/download/host-app-v{$version}/BlockSurvivalHost-{$version}.msi",
        ];
    }

    public function test_the_newest_published_host_app_release_with_an_msi_is_picked(): void
    {
        $picked = HostAppRelease::pick([
            $this->release('1.0.0', [$this->msi('9.9.9')]),                                  // the game's tag, not the host app's
            $this->release('host-app-v2.0.0', [$this->msi('2.0.0')], ['draft' => true]),
            $this->release('host-app-v1.9.0', [$this->msi('1.9.0')], ['prerelease' => true]),
            $this->release('host-app-v1.2.0', [['name' => 'notes.txt', 'size' => 1, 'browser_download_url' => 'https://github.com/x/notes.txt']]),
            $this->release('host-app-v1.1.0', [$this->msi('1.1.0')]),
            $this->release('host-app-v1.0.0', [$this->msi('1.0.0')]),
        ]);

        $this->assertSame('1.1.0', $picked['version']);
        $this->assertSame('BlockSurvivalHost-1.1.0.msi', $picked['name']);
        $this->assertStringStartsWith('https://github.com/', $picked['url']);
        $this->assertNull(HostAppRelease::pick([]));
        // an asset URL off GitHub is never offered
        $this->assertNull(HostAppRelease::pick([$this->release('host-app-v1.0.0', [['name' => 'x.msi', 'size' => 1, 'browser_download_url' => 'https://evil.example/x.msi']])]));
    }

    public function test_admins_download_it_through_a_redirect_and_github_is_asked_once(): void
    {
        Http::fake([self::API => Http::response([$this->release('host-app-v1.0.1', [$this->msi('1.0.1')])])]);
        $admin = User::factory()->admin()->create();

        $this->actingAs($admin)->get('/admin/host-app/download')
            ->assertRedirect('https://github.com/thabang-teddy/Block-survival/releases/download/host-app-v1.0.1/BlockSurvivalHost-1.0.1.msi');
        $this->actingAs($admin)->get('/admin/host-app/download')->assertRedirect();
        Http::assertSentCount(1);
    }

    public function test_players_cannot_download_it(): void
    {
        Http::fake();
        $this->signIn(User::factory()->create())->get('/admin/host-app/download')->assertForbidden();
        $this->app['auth']->forgetGuards();
        $this->get('/admin/host-app/download')->assertRedirect('/login');
        Http::assertNothingSent();
    }

    public function test_with_nothing_released_or_github_down_the_admin_is_told_so(): void
    {
        Http::fake([self::API => Http::response(['message' => 'boom'], 500)]);
        $admin = User::factory()->admin()->create();

        $this->actingAs($admin)->from('/admin/pc-hosts')->get('/admin/host-app/download')
            ->assertRedirect('/admin/pc-hosts')
            ->assertSessionHas('status', 'No Block Survival Host installer has been released yet (or GitHub could not be reached).');
    }

    public function test_the_host_pcs_page_defers_the_installer_lookup(): void
    {
        Http::fake([self::API => Http::response([$this->release('host-app-v1.0.1', [$this->msi('1.0.1')])])]);
        $admin = User::factory()->admin()->create();

        // the first render does not wait on GitHub…
        $this->actingAs($admin)->get('/admin/pc-hosts')->assertInertia(fn (Assert $page) => $page
            ->component('Admin/Hosts')
            ->missing('hostApp'));
        Http::assertNothingSent();

        // …the deferred request fetches it
        $this->actingAs($admin)->get('/admin/pc-hosts')->assertInertia(fn (Assert $page) => $page
            ->loadDeferredProps(fn (Assert $reload) => $reload
                ->where('hostApp.version', '1.0.1')
                ->where('hostApp.size', 100_000_000)));
    }
}
